import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Task from '../../../src/task';
import { impersonate } from '../../../src/signers';
import { getForkedNetwork } from '../../../src/test';
import { AuthorizerDeployment } from '../../20210418-authorizer/input';
import { TimelockAuthorizerDeployment } from '../input';

describe.only('TimelockAuthorizer', function () {
  let input: TimelockAuthorizerDeployment;
  let migrator: Contract, vault: Contract, newAuthorizer: Contract, oldAuthorizer: Contract;
  let EVERYWHERE: string, GRANT_ACTION_ID: string, REVOKE_ACTION_ID: string, DEFAULT_ADMIN_ROLE: string;

  const task = Task.forTest('2022xxxx-timelock-authorizer', getForkedNetwork(hre));

  before('run task', async () => {
    await task.run({ force: true });
    input = task.input() as TimelockAuthorizerDeployment;
    migrator = await task.deployedInstance('TimelockAuthorizerMigrator');
    newAuthorizer = await task.deployedInstance('TimelockAuthorizer');
  });

  before('load vault', async () => {
    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await migrator.vault());
  });

  before('load old authorizer and impersonate multisig', async () => {
    const authorizerTask = Task.forTest('20210418-authorizer', getForkedNetwork(hre));
    oldAuthorizer = await authorizerTask.instanceAt('Authorizer', await migrator.oldAuthorizer());

    const authorizerInput = authorizerTask.input() as AuthorizerDeployment;
    const multisig = await impersonate(authorizerInput.admin, fp(100));
    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.connect(multisig).grantRolesToMany([setAuthorizerActionId], [migrator.address]);
  });

  before('setup constants', async () => {
    EVERYWHERE = await newAuthorizer.EVERYWHERE();
    GRANT_ACTION_ID = await newAuthorizer.GRANT_ACTION_ID();
    REVOKE_ACTION_ID = await newAuthorizer.REVOKE_ACTION_ID();
    DEFAULT_ADMIN_ROLE = await oldAuthorizer.DEFAULT_ADMIN_ROLE();
  });

  before('migrate', async () => {
    await migrator.migrate(0);
  });

  it('runs the migration properly', async () => {
    expect(await migrator.migratedRoles()).to.be.equal(input.rolesData.length);
  });

  it('migrates all roles properly', async () => {
    for (const roleData of input.rolesData) {
      const membersCount = await oldAuthorizer.getRoleMemberCount(roleData.role);
      for (let i = 0; i < membersCount; i++) {
        const member = await oldAuthorizer.getRoleMember(roleData.role, i);
        expect(await newAuthorizer.hasPermission(roleData.role, member, roleData.target)).to.be.true;
      }
    }
  });

  it('migrates all admin roles properly', async () => {
    const GRANT_ACTION_ID = await newAuthorizer.GRANT_ACTION_ID();
    const REVOKE_ACTION_ID = await newAuthorizer.REVOKE_ACTION_ID();

    for (const roleData of input.rolesData) {
      const adminRole = await oldAuthorizer.getRoleAdmin(roleData.role);
      const adminsCount = await oldAuthorizer.getRoleMemberCount(adminRole);
      for (let i = 0; i < adminsCount; i++) {
        const admin = await oldAuthorizer.getRoleMember(adminRole, i);
        expect(await newAuthorizer.hasPermission(GRANT_ACTION_ID, admin, roleData.target)).to.be.true;
        expect(await newAuthorizer.hasPermission(REVOKE_ACTION_ID, admin, roleData.target)).to.be.true;
      }
    }
  });

  it('migrates all the default admins properly', async () => {
    const adminsCount = await oldAuthorizer.getRoleMemberCount(DEFAULT_ADMIN_ROLE);
    for (let i = 0; i < adminsCount; i++) {
      const admin = await oldAuthorizer.getRoleMember(DEFAULT_ADMIN_ROLE, i);
      expect(await newAuthorizer.hasPermission(GRANT_ACTION_ID, admin, EVERYWHERE)).to.be.true;
      expect(await newAuthorizer.hasPermission(REVOKE_ACTION_ID, admin, EVERYWHERE)).to.be.true;
    }
  });

  it('sets the new authorizer properly', async () => {
    expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
  });

  it('revokes the admin roles from the migrator', async () => {
    const EVERYWHERE = await newAuthorizer.EVERYWHERE();
    const GRANT_ACTION_ID = await newAuthorizer.GRANT_ACTION_ID();
    const REVOKE_ACTION_ID = await newAuthorizer.REVOKE_ACTION_ID();

    expect(await newAuthorizer.hasPermission(GRANT_ACTION_ID, migrator.address, EVERYWHERE)).to.be.false;
    expect(await newAuthorizer.hasPermission(REVOKE_ACTION_ID, migrator.address, EVERYWHERE)).to.be.false;
  });
});
