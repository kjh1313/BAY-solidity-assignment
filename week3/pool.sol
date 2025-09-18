// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

//pool = 0xa5df42eca6c9d3ab5c916f9f8990d05a7f3acc76
interface IUniswapV3Factory {
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);
}

interface IUniswapV3PoolImmutables {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

contract SimpleV3Check {
    address public constant FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;  //docs에서 찾음
    address public constant POOL = 0x0A03D853715f614D3010278a2390Eddb59599e82;     //scan에서 pool주소찾기

    function check() external view returns (address token0, address token1, uint24 fee, address lookup)
    {
        token0 = IUniswapV3PoolImmutables(POOL).token0();
        token1 = IUniswapV3PoolImmutables(POOL).token1();
        fee    = IUniswapV3PoolImmutables(POOL).fee();

        lookup = IUniswapV3Factory(FACTORY).getPool(token0, token1, fee);
    }
}