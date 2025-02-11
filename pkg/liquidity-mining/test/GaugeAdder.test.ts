import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

enum GaugeType {
  LiquidityMiningCommittee = 0,
  veBAL,
  Ethereum,
  Polygon,
  Arbitrum,
}

describe('GaugeAdder', () => {
  let vault: Vault;
  let authorizer: Contract;
  let gaugeController: Contract;
  let gaugeFactory: Contract;
  let adaptor: Contract;
  let gaugeAdder: Contract;

  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');
    authorizer = vault.authorizer;

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeController = await deploy('MockGaugeController', { args: [adaptor.address] });

    gaugeFactory = await deploy('MockLiquidityGaugeFactory');
    gaugeAdder = await deploy('GaugeAdder', { args: [gaugeController.address] });

    await gaugeController.add_type('LiquidityMiningCommittee', 0);
    await gaugeController.add_type('veBAL', 0);
    await gaugeController.add_type('Ethereum', 0);
  });

  sharedBeforeEach('set up permissions', async () => {
    const action = await actionId(adaptor, 'add_gauge', gaugeController.interface);
    await vault.grantPermissionsGlobally([action], gaugeAdder);
  });

  async function deployGauge(poolAddress: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    return event.args.gauge;
  }

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await gaugeAdder.getVault()).to.be.eq(vault.address);
    });

    it('sets the authorizer adaptor address', async () => {
      expect(await gaugeAdder.getAuthorizerAdaptor()).to.be.eq(adaptor.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await gaugeAdder.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await vault.grantPermissionsGlobally([action], admin.address);

      await vault.instance.connect(admin).setAuthorizer(other.address);

      expect(await gaugeAdder.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('addGaugeFactory', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          gaugeAdder.connect(other).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addGaugeFactory');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge type does not exist on GaugeController', () => {
        it('reverts', async () => {
          await expect(
            gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Polygon)
          ).to.be.revertedWith('Invalid gauge type');
        });
      });

      context('when gauge type exists on GaugeController', () => {
        context('when factory already exists on GaugeAdder', () => {
          sharedBeforeEach('add gauge factory', async () => {
            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
          });

          it('reverts', async () => {
            await expect(
              gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum)
            ).to.be.revertedWith('Factory already added');
          });
        });

        context("when factory doesn't already exists on GaugeAdder", () => {
          it('stores the new factory address', async () => {
            expect(await gaugeAdder.getFactoryForGaugeTypeCount(GaugeType.Ethereum)).to.be.eq(0);
            await expect(gaugeAdder.getFactoryForGaugeType(GaugeType.Ethereum, 0)).to.be.revertedWith('OUT_OF_BOUNDS');

            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);

            expect(await gaugeAdder.getFactoryForGaugeTypeCount(GaugeType.Ethereum)).to.be.eq(1);
            expect(await gaugeAdder.getFactoryForGaugeType(GaugeType.Ethereum, 0)).to.be.eq(gaugeFactory.address);
          });

          it('emits a GaugeFactoryAdded event', async () => {
            const tx = await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
            const receipt = await tx.wait();
            expectEvent.inReceipt(receipt, 'GaugeFactoryAdded', {
              gaugeType: GaugeType.Ethereum,
              gaugeFactory: gaugeFactory.address,
            });
          });
        });
      });
    });
  });

  describe('isGaugeFromValidFactory', () => {
    let gauge: string;

    sharedBeforeEach('deploy gauge', async () => {
      gauge = await deployGauge(ZERO_ADDRESS);
    });

    context('when factory has been added to GaugeAdder', () => {
      sharedBeforeEach('add gauge factory', async () => {
        const action = await actionId(gaugeAdder, 'addGaugeFactory');
        await vault.grantPermissionsGlobally([action], admin);

        await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
      });

      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Ethereum)).to.be.true;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Polygon)).to.be.false;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Arbitrum)).to.be.false;
      });
    });

    context('when factory has not been added to GaugeAdder', () => {
      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Ethereum)).to.be.false;
      });
    });
  });

  describe('addEthereumGauge', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addEthereumGauge(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addEthereumGauge');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge has not been deployed from a valid factory', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.connect(admin).addEthereumGauge(ZERO_ADDRESS)).to.be.revertedWith('Invalid gauge');
        });
      });

      context('when gauge has been deployed from a valid factory', () => {
        sharedBeforeEach('add gauge factory', async () => {
          const action = await actionId(gaugeAdder, 'addGaugeFactory');
          await vault.grantPermissionsGlobally([action], admin);

          await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
        });

        it('registers the gauge on the GaugeController', async () => {
          const gauge = await deployGauge(ZERO_ADDRESS);

          const tx = await gaugeAdder.connect(admin).addEthereumGauge(gauge);

          expectEvent.inIndirectReceipt(await tx.wait(), gaugeController.interface, 'NewGauge', {
            addr: gauge,
            gauge_type: GaugeType.Ethereum,
            weight: 0,
          });
        });
      });
    });
  });
});
