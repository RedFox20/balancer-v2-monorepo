// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Clones.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./interfaces/IStakingLiquidityGauge.sol";
import "./interfaces/ILiquidityGaugeFactory.sol";

contract LiquidityGaugeFactory is ILiquidityGaugeFactory, Authentication {
    IVault private immutable _vault;
    ILiquidityGauge private _gaugeImplementation;

    mapping(address => bool) private _isGaugeFromFactory;
    mapping(address => address) private _poolGauge;

    event GaugeCreated(address indexed gauge, address indexed pool);
    event GaugeImplementationUpdated(address oldGaugeImplementation, address newGaugeImplementation);

    constructor(IVault vault, ILiquidityGauge gauge) Authentication(bytes32(uint256(address(this)))) {
        _vault = vault;
        _gaugeImplementation = gauge;

        emit GaugeImplementationUpdated(address(0), address(gauge));
    }

    /**
     * @dev Returns the address of the Vault.
     */
    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @dev Returns the address of the Vault's Authorizer.
     */
    function getAuthorizer() public view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    /**
     * @notice Returns the address of the implementation used for gauge deployments.
     */
    function getGaugeImplementation() public view returns (ILiquidityGauge) {
        return _gaugeImplementation;
    }

    /**
     * @notice Returns the address of the gauge belonging to `pool`.
     */
    function getPoolGauge(address pool) external view returns (ILiquidityGauge) {
        return ILiquidityGauge(_poolGauge[pool]);
    }

    /**
     * @notice Returns true if `gauge` was created by this factory.
     */
    function isGaugeFromFactory(address gauge) external view override returns (bool) {
        return _isGaugeFromFactory[gauge];
    }

    /**
     * @notice Sets the address of the gauge implementation to be used for future deployments
     */
    function setGaugeImplementation(address newGaugeImplementation) external authenticate {
        address currentGaugeImplementation = address(_gaugeImplementation);

        _gaugeImplementation = ILiquidityGauge(newGaugeImplementation);
        emit GaugeImplementationUpdated(currentGaugeImplementation, newGaugeImplementation);
    }

    /**
     * @notice Deploys a new gauge for a Balancer pool.
     * @dev As anyone can register arbitrary Balancer pools with the Vault,
     * it's impossible to prove onchain that `pool` is a "valid" deployment.
     *
     * Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     *
     * This factory disallows deploying multiple gauges for a single pool.
     * @param pool The address of the pool for which to deploy a gauge
     * @return The address of the deployed gauge
     */
    function create(address pool) external returns (address) {
        require(_poolGauge[pool] == address(0), "Gauge already exists");

        address gaugeImplementation = address(getGaugeImplementation());
        require(gaugeImplementation != address(0), "Gauge deployment halted");

        address gauge = Clones.clone(gaugeImplementation);

        IStakingLiquidityGauge(gauge).initialize(pool);

        _isGaugeFromFactory[gauge] = true;
        _poolGauge[pool] = gauge;
        emit GaugeCreated(gauge, pool);

        return gauge;
    }

    // Authorization

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return getAuthorizer().canPerform(actionId, account, address(this));
    }
}
