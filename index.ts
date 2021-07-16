import { config } from "dotenv"
import { createClient } from "@urql/core";
import { BigNumber } from "bignumber.js";
import fetch from 'cross-fetch';
import { promises as fs } from "fs";
import { Position, Pool, FeeAmount } from "@uniswap/v3-sdk";
import { Token } from "@uniswap/sdk-core";

config()

const getData = async (id: number, blockNumber?: number) => {

  const position = await getPositionInfo(id, blockNumber);

  const liquidity = new BigNumber(position.liquidity);

  const feeGlobal0 = new BigNumber(position.pool.feeGrowthGlobal0X128);
  const feeGlobal1 = new BigNumber(position.pool.feeGrowthGlobal1X128);

  const feeInside0 = new BigNumber(position.feeGrowthInside0LastX128);
  const feeInside1 = new BigNumber(position.feeGrowthInside1LastX128);

  const feeOutsideTickLower0 = new BigNumber(position.tickLower.feeGrowthOutside0X128);
  const feeOutsideTickLower1 = new BigNumber(position.tickLower.feeGrowthOutside1X128);
  const feeOutsideTickUpper0 = new BigNumber(position.tickUpper.feeGrowthOutside0X128);
  const feeOutsideTickUpper1 = new BigNumber(position.tickUpper.feeGrowthOutside1X128);

  const currentTick = parseInt(position.pool.tick);
  const tickLower = parseInt(position.tickLower.tickIdx);
  const tickUpper = parseInt(position.tickUpper.tickIdx);

  const feesRaw0 = calculateFee(feeGlobal0, feeOutsideTickUpper0, feeOutsideTickLower0, feeInside0, liquidity, currentTick, tickLower, tickUpper);
  const feesRaw1 = calculateFee(feeGlobal1, feeOutsideTickUpper1, feeOutsideTickLower1, feeInside1, liquidity, currentTick, tickLower, tickUpper);

  const decimals0 = parseInt(position.token0.decimals);
  const decimals1 = parseInt(position.token1.decimals);

  const feesUnclaimed0 = feesRaw0.dividedBy(new BigNumber(`1e${decimals0}`)).toNumber();
  const feesUnclaimed1 = feesRaw1.dividedBy(new BigNumber(`1e${decimals1}`)).toNumber();

  const fees0 = feesUnclaimed0 + parseFloat(position.collectedFeesToken0);
  const fees1 = feesUnclaimed1 + parseFloat(position.collectedFeesToken1);

  const price0 = parseFloat(position.token0.tokenDayData[0].priceUSD);
  const price1 = parseFloat(position.token1.tokenDayData[0].priceUSD);

  const sqrtPrice = new BigNumber(position.pool.sqrtPrice);

  const feeTier = position.pool.feeTier;

  let feeAmount;
  if (feeTier === "3000") {
    feeAmount = FeeAmount.MEDIUM
  } else if (feeTier === "10000") {
    feeAmount = FeeAmount.HIGH
  } else {
    feeAmount = FeeAmount.LOW
  }

  const tokenA = new Token(1, "0x0000000000000000000000000000000000000001", decimals0, "", position.token0.name);
  const tokenB = new Token(1, "0x0000000000000000000000000000000000000002", decimals1, "", position.token1.name);
  const pool = new Pool(tokenA, tokenB, feeAmount, Math.round(sqrtPrice.toNumber()), Math.round(liquidity.toNumber()), currentTick);
  const positionHelper = new Position({ 
    pool: pool, 
    liquidity: Math.round(liquidity.toNumber()),
    tickLower: tickLower, 
    tickUpper: tickUpper,
  })  

  const amount0 = parseFloat(positionHelper.amount0.toFixed(6));
  const amount1 = parseFloat(positionHelper.amount1.toFixed(6));

  const totalFeeValue = fees0 * price0 + fees1 * price1;
  const totalValueExcludingFees = amount0 * price0 + amount1 * price1;

  // get ETH price data
  const ethPrice = await getEthPrice(blockNumber);

  return {
    name0: position.token0.name as string,
    price0: price0,
    fees0: fees0,
    name1: position.token1.name as string,
    price1: price1,
    fees1: fees1,
    date: new Date(parseInt(position.token1.tokenDayData[0].date) * 1000).toDateString(),
    totalFeeValue: totalFeeValue,
    amount0: amount0,
    amount1: amount1,
    totalValueExcludingFees: totalValueExcludingFees,
    totalValueIncludingFees: totalValueExcludingFees + totalFeeValue,
    totalValueExcludingFees_eth: totalValueExcludingFees / ethPrice,
    totalValueIncludingFees_eth: (totalValueExcludingFees + totalFeeValue) / ethPrice,
    ethPrice: ethPrice
  }
}

const getAmount0 = (liquidity: BigNumber, sqrtPrice: BigNumber, tickUpper: number): BigNumber => {
  return getAmount0Delta(liquidity, sqrtPrice, getSqrtRatioAtTick(tickUpper));
}

// sqrt(1.0001^tick) * 2^96
const getSqrtRatioAtTick = (tick: number): BigNumber => {
  console.log(tick)
  const res = new BigNumber(Math.sqrt(1.0001^tick)).multipliedBy(new BigNumber(2).pow(new BigNumber(96)));
  console.log(res.toString())
  return res
}

const getAmount0Delta = (liquidity: BigNumber, sqrtRatioA: BigNumber, sqrtRatioB: BigNumber): BigNumber => {
  let [ sqrtRatioAdjustedA, sqrtRatioAdjustedB ] = [ sqrtRatioA, sqrtRatioB]
  if (sqrtRatioA.gt(sqrtRatioB)) [ sqrtRatioAdjustedA, sqrtRatioAdjustedB ] = [ sqrtRatioB, sqrtRatioA ];

  const x96 = new BigNumber(2).pow(new BigNumber(96));
  const a = liquidity.multipliedBy(x96);
  const b = sqrtRatioAdjustedB.minus(sqrtRatioAdjustedA);
  return a.multipliedBy(b).dividedBy(sqrtRatioAdjustedB).dividedBy(sqrtRatioAdjustedA);
}

const calculateFee = (
  feeGlobal: BigNumber,
  feeOutsideTickLower: BigNumber,
  feeOutsideTickUpper: BigNumber,
  feeInside: BigNumber,
  liquidity: BigNumber,
  currentTick: number,
  tickLower: number,
  tickUpper: number
): BigNumber => {
  const x128 = new BigNumber(2).pow(new BigNumber(128));
  if (currentTick >= tickLower && currentTick <= tickUpper) {
    return feeGlobal.minus(feeOutsideTickLower).minus(feeOutsideTickUpper).minus(feeInside).multipliedBy(liquidity).dividedBy(x128);
  } else if (currentTick > tickUpper) {
    return feeGlobal.minus(feeOutsideTickLower).minus(feeOutsideTickUpper).minus(feeInside).multipliedBy(liquidity).dividedBy(x128);
  } else {
    return feeGlobal.minus(feeOutsideTickUpper).minus(feeOutsideTickLower).minus(feeInside).multipliedBy(liquidity).dividedBy(x128);
  }
}

const getPositionInfo = async (id: number, blockNumber?: number) => {

  const url = `https://gateway.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/0x9bde7bf4d5b13ef94373ced7c8ee0be59735a298-2`;

  const query = `
    query {
      positions(where: {id: "${id}"} ${blockNumber ? `block: {number: ${blockNumber}}` : ""}) {
        token0 {
          name
          decimals

          tokenDayData(orderBy:date, orderDirection: desc, first: 1) {
            priceUSD
            date
          }
        }
        token1 {
          name
          decimals

          tokenDayData(orderBy:date, orderDirection: desc, first: 1) {
            priceUSD
            date
          }
        }

        liquidity
        feeGrowthInside0LastX128
        feeGrowthInside1LastX128

        collectedFeesToken0
        collectedFeesToken1
        
        pool {
          feeGrowthGlobal0X128
          feeGrowthGlobal1X128
          tick
          sqrtPrice
          feeTier
        }
        
        tickLower {
          feeGrowthOutside0X128
          feeGrowthOutside1X128
          tickIdx
        }
        tickUpper {
          feeGrowthOutside0X128
          feeGrowthOutside1X128
          tickIdx
        }
      }
    }
  `;

  const client = createClient({
    url: url,
    fetch: fetch
  });

  const res = await client.query(query).toPromise();

  return res.data.positions[0];
}

const getPositionCreationBlock = async (id: number): Promise<number> => {
  const url = `https://gateway.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/0x9bde7bf4d5b13ef94373ced7c8ee0be59735a298-2`;

  const query = `
    query {
      positions(where: {id: "${id}"}) {
        transaction {
          blockNumber
        }
      }
    }
  `;

  const client = createClient({
    url: url,
    fetch: fetch
  });

  const res = await client.query(query).toPromise();

  return parseInt(res.data.positions[0].transaction.blockNumber);
}

const getEthPrice = async (blockNumber?: number) => {
  const url = `https://gateway.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/0x9bde7bf4d5b13ef94373ced7c8ee0be59735a298-2`;

  const query = `
    {
      pools (
        where: {
          token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 
          token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 
          feeTier: "3000"
        },
        ${blockNumber ? `block: {number: ${blockNumber}}` : ""}
      ) {
        token0Price
        token1Price
      }
    }
  `;

  const client = createClient({
    url: url,
    fetch: fetch
  });

  const res = await client.query(query).toPromise();

  return parseInt(res.data.pools[0].token0Price);
}

const getDataRange = async (id: number, gap: number) => {
  const creationBlock = await getPositionCreationBlock(id)

  const fees = [];

  for (let i = creationBlock; ; i += gap) {
    try {
      fees.push(await getData(id, i));
      console.log("indexing block: " + i);
    } catch (err) {
      break;
    }
  }

  return fees;
}


const args = process.argv.slice(2);
const id = parseInt(args[0]);
const fileName = args[1];

getDataRange(id, Math.round(60*60*24/13)).then(async res => {

  await fs.writeFile(fileName, "date,price0,price1,name0,name1,fees0,fees1,totalFeeValue,amount0,amount1,totalValueExcludingFees,totalValueIncludingFees,totalValueExcludingFees_eth,totalValueIncludingFees_eth,ethPrice\n");

  for (let i = 0; i < res.length; i++) {
    const entry = res[i];
    await fs.appendFile(fileName, `${entry.date},${entry.price0},${entry.price1},${entry.name0},${entry.name1},${entry.fees0},${entry.fees1},${entry.totalFeeValue},${entry.amount0},${entry.amount1},${entry.totalValueExcludingFees},${entry.totalValueIncludingFees},${entry.totalValueExcludingFees_eth},${entry.totalValueIncludingFees_eth},${entry.ethPrice}\n`);
  }

  console.log("Saved to file: " + fileName)
});


/** find DPI-WETH tokens
 * 
 *  {
 *    positions (where: {token0: "0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b", token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"}) {
 * 	    id
 *    }
 *  }
 * 
 */