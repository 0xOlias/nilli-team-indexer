import type { Context } from "@/generated"
import type { UserEvent } from "@indexer/types"
import { getBlockTimestamp, getEventType } from "./utils"

function getPrices(event: UserEvent, eventType: "buy" | "sell" | "redeem" | "transfer" | "unknown") {
  const defaultPrices = {
    priceBase: 0n,
    pricePoolFee: 0n,
    priceProtocolFee: 0n,
    priceCollectiveFee: 0n,
    priceTotalFee: 0n,
    priceTotal: 0n,
    pricePerVote: 0n,
  }

  if (["buy", "sell"].includes(eventType) && "price" in event.args) {
    return {
      priceBase: event.args.price.base,
      pricePoolFee: event.args.price.poolFee,
      priceProtocolFee: event.args.price.protocolFee,
      priceCollectiveFee: event.args.price.collectiveFee,
      priceTotalFee: event.args.price.totalFee,
      priceTotal: event.args.price.total,
      pricePerVote: event.args.price.perVote,
    }
  }
  if (eventType === "redeem" && "value" in event.args) {
    return {
      ...defaultPrices,
      priceBase: event.args.value,
      priceTotal: event.args.value,
    }
  }

  // Event types 'transfer' and 'unknown' have no price data
  return defaultPrices
}

export async function createEvent(context: Context, event: UserEvent) {
  const timestamp = await getBlockTimestamp(context, event.transaction.blockNumber)
  const eventType = getEventType(event)

  const priceData = getPrices(event, eventType)

  return await context.db.Event.create({
    id: event.log.id,
    data: {
      fanId: event.args.fan,
      collectiveId: event.args.collective,
      contractId: event.log.address,
      eventType,
      // Vote information
      voteAmount: event.args.voteAmount,
      fanVotes: event.args.fanVotes,
      supply: event.args.supply,
      // Price information
      ...priceData,
      // Timestamps
      hash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.transaction.blockNumber,
      timestamp,
    },
  })
}
