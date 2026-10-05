// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Lo mínimo de una Safe para el ensayo del deploy a mainnet
/// (check-mainnet-deploy.sh): contesta `getOwners` y `getThreshold` como una
/// Safe de verdad, y uno de sus dueños le hace mandar una llamada (ahí, el
/// `acceptOwnership` del escrow). No junta firmas: no es una Safe.
contract MockSafe {
    address[] private owners;
    uint256 private immutable threshold;

    constructor(address[] memory owners_, uint256 threshold_) {
        owners = owners_;
        threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }

    function exec(address to, bytes calldata data) external returns (bytes memory) {
        bool isOwner;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == msg.sender) isOwner = true;
        }
        require(isOwner, "not owner");
        (bool ok, bytes memory ret) = to.call(data);
        require(ok, "call failed");
        return ret;
    }
}
