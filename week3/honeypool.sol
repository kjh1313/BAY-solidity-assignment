// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function fee() external view returns (uint24);
}

contract V3PoolHelper {
    address public constant FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c; //sepolia factory 주소
    event PoolCreated(address pool, address token0, address token1, uint24 fee);
    event PoolInitialized(address pool, uint160 sqrtPriceX96);

    // create pool 
    function createpool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        require(tokenA != tokenB, "same token");

        // 1) 이미 풀 있는지 확인
        pool = IUniswapV3Factory(FACTORY).getPool(tokenA, tokenB, fee);
        if (pool == address(0)) {
            // 2) 없으면 생성
            pool = IUniswapV3Factory(FACTORY).createPool(tokenA, tokenB, fee);
        }

        // 3) 풀의 token0/token1 읽기 (주소값으로 정렬되어 있음)
        address t0 = IUniswapV3Pool(pool).token0();
        address t1 = IUniswapV3Pool(pool).token1();
        uint24 feeSet = IUniswapV3Pool(pool).fee();
        require(feeSet == fee, "fee mismatch");
        // 간단 검증: 이 풀이 같은 팩토리에서 온 것인지
        require(IUniswapV3Pool(pool).factory() == FACTORY, "not factory pool");
        emit PoolCreated(pool, t0, t1, fee);
        return pool;
    }

    /// @notice 이미 존재하는 풀을 1:1로 초기화만 하고 싶을 때
    function initPool_1to1(address pool) external {
        require(pool != address(0), "zero pool");
        uint160 oneToOne = uint160(1) << 96;
        IUniswapV3Pool(pool).initialize(oneToOne);
        emit PoolInitialized(pool, oneToOne);
    }

    /// @notice 팩토리 getPool과 주소가 일치하는지 간단 검증
    function verify(address pool) external view returns (bool ok) {
        address t0 = IUniswapV3Pool(pool).token0();
        address t1 = IUniswapV3Pool(pool).token1();
        uint24 f = IUniswapV3Pool(pool).fee();
        ok = (IUniswapV3Pool(pool).factory() == FACTORY) &&
             (IUniswapV3Factory(FACTORY).getPool(t0, t1, f) == pool);
    }
}
