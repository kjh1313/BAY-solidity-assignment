// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 🍯 HoneyTokenA
contract HoneyTokenA is ERC20 {
    constructor(uint256 initialSupply) ERC20("HoneyTokenA", "HNA") {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }
}

// 🍯 HoneyTokenB
contract HoneyTokenB is ERC20 {
    constructor(uint256 initialSupply) ERC20("HoneyTokenB", "HNB") {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }
}
