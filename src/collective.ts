import type { Context, Event } from "@/generated"
import type { UserEvent } from "@indexer/types"
import { getBlockTimestamp } from "@indexer/utils"
import { ERC20 } from "abis/ERC20"
import type { Address } from "viem"

const ONE_DAY_OF_BLOCKS = 43_200n

async function readCollectiveVotes(context: Context, contract: Address, collective: Address) {
  const result = await context.client.readContract({
    abi: context.contracts.BG_Beta.abi,
    address: contract,
    functionName: "collectives",
    args: [collective],
  })
  if (result === undefined || result === null) {
    console.warn(`WARN: Function call 'collectives' failed, contract: ${contract}, args: ${[collective]}`)
    return { name: "", voteCount: 0n, burntVoteCount: 0n }
  }

  return {
    name: result[0],
    voteCount: result[1],
    burntVoteCount: result[2],
  }
}

async function readClaimerVotes(context: Context, contract: Address, collective: Address) {
  const { claimerAccount } = (await context.db.Contract.findUnique({ id: contract })) ?? {
    claimerAccount: process.env.DEFAULT_CLAIMER as Address,
  }
  if (!claimerAccount) throw new Error("claimerAccount is undefined, is the environment variable set?")

  const result = await context.client.readContract({
    abi: context.contracts.BG_Beta.abi,
    address: contract,
    functionName: "balanceOf",
    args: [claimerAccount, collective],
  })
  if (result === null || result === undefined) {
    console.warn(`WARN: Function call 'balanceOf' failed, contract: ${contract}, args: ${[claimerAccount, collective]}`)
    return 0n
  }

  return result
}

async function readTreasuryValue(context: Context, token: Address, collective: Address) {
  const result = await context.client.readContract({
    abi: ERC20,
    address: token,
    functionName: "balanceOf",
    args: [collective],
  })
  if (result === undefined || result === null) {
    console.warn(`WARN: Function call 'balanceOf' failed, token: ${token}, args: ${[collective]}`)
    return 0n
  }

  return result
}

async function calculatePercentChange(context: Context, event: UserEvent) {
  if (!("price" in event.args)) return 0
  const collectiveData = await context.db.Event.findMany({
    where: {
      collectiveId: event.args.collective,
      blockNumber: {
        gte: event.transaction.blockNumber - ONE_DAY_OF_BLOCKS,
      },
      OR: [{ eventType: "buy" }, { eventType: "sell" }],
    },
    orderBy: {
      blockNumber: "asc",
    },
  })
  if (collectiveData.items.length === 0) return 0

  const oldPrice = Number(collectiveData.items[0].priceBase)
  const newPrice = Number(event.args.price.base)
  return ((newPrice - oldPrice) / oldPrice) * 100
}

function getPrice(event: UserEvent) {
  if ("price" in event.args) return event.args.price.base
  if ("value" in event.args) return event.args.value
  return 0n
}

function getPosition(
  event:
    | Event<"BG_Beta:DistributeCollectiveWinnings">
    | Event<"BG_Beta:OraclewinPositionVerified">
    | Event<"BG_Beta:SetCollectiveFanbase">,
) {
  if ("exitRound" in event.args) return event.args.exitRound
  if ("round" in event.args) return event.args.round
  return undefined
}

export async function upsertCollective(context: Context, event: UserEvent) {
  const timestamp = await getBlockTimestamp(context, event.transaction.blockNumber)
  const contractData = await context.db.Contract.findUnique({ id: event.log.address })
  if (!contractData) console.warn(`WARN: Contract not found, address: ${event.log.address}`)

  // Onchain data
  const { voteCount, burntVoteCount } = await readCollectiveVotes(context, event.log.address, event.args.collective)
  const claimerVoteCount = await readClaimerVotes(context, event.log.address, event.args.collective)

  let treasuryValue = 0n
  if (contractData) treasuryValue = await readTreasuryValue(context, contractData.stableCoin, event.args.collective)

  // Derived values
  const price = getPrice(event)
  const percentChange = await calculatePercentChange(context, event)
  const fanBalance = await context.db.Balance.findUnique({
    id: `${event.args.fan}:${event.args.collective}`,
  })

  return await context.db.Collective.upsert({
    id: event.args.collective,
    create: {
      price,
      fanCount: 1n,
      voteCount: 1n,
      burntVoteCount: 0n,
      claimerVoteCount: 0n,
      treasuryValue: 0n,
      percentChange,
      contractId: event.log.address,
      // Timestamps
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEventId: event.log.id,
    },
    update: ({ current }) => ({
      price,
      fanCount: current.fanCount + (!fanBalance ? 1n : event.args.fanVotes === 0n ? -1n : 0n),
      voteCount,
      burntVoteCount,
      claimerVoteCount,
      treasuryValue,
      percentChange,
      contractId: event.log.address,
      // Timestamps
      updatedAt: timestamp,
      lastEventId: event.log.id,
    }),
  })
}

export async function updateAdminCollective(
  context: Context,
  event:
    | Event<"BG_Beta:DistributeCollectiveWinnings">
    | Event<"BG_Beta:OraclewinPositionVerified">
    | Event<"BG_Beta:SetCollectiveFanbase">,
) {
  const timestamp = await getBlockTimestamp(context, event.transaction.blockNumber)
  const contractData = await context.db.Contract.findUnique({ id: event.log.address })
  if (!contractData) console.warn(`WARN: Contract not found, address: ${event.log.address}`)

  // Onchain data
  const { voteCount, burntVoteCount } = await readCollectiveVotes(context, event.log.address, event.args.collective)
  const claimerVoteCount = await readClaimerVotes(context, event.log.address, event.args.collective)

  let treasuryValue = 0n
  if (contractData) treasuryValue = await readTreasuryValue(context, contractData.stableCoin, event.args.collective)

  // Derived values
  const position = getPosition(event)
  const fanbase = "fanbase" in event.args ? event.args.fanbase : undefined

  return await context.db.Collective.upsert({
    id: event.args.collective,
    create: {
      price: 1n,
      fanCount: 1n,
      voteCount: 1n,
      burntVoteCount: 0n,
      claimerVoteCount: 0n,
      treasuryValue: 0n,
      percentChange: 0,
      contractId: event.log.address,
      // Timestamps
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEventId: event.log.id,
    },
    update: {
      voteCount,
      burntVoteCount,
      claimerVoteCount,
      position,
      fanbase,
      treasuryValue,
      // Timestamps
      updatedAt: timestamp,
      lastEventId: event.log.id,
    },
  })
}
