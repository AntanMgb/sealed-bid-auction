"use client";

import { FC, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { AuctionEvent } from "@/lib/magicblock";

interface Props {
  events: AuctionEvent[];
}

const EVENT_ICONS: Record<AuctionEvent["type"], string> = {
  bid_placed: "🔒",
  auction_closed: "✅",
  auction_settled: "🏆",
  bid_count: "📊",
};

const EVENT_COLORS: Record<AuctionEvent["type"], string> = {
  bid_placed: "border-l-yellow-400 bg-yellow-400/5",
  auction_closed: "border-l-green-400 bg-green-400/5",
  auction_settled: "border-l-purple-400 bg-purple-400/5",
  bid_count: "border-l-blue-400 bg-blue-400/5",
};

/**
 * Real-time transaction feed from the Private Ephemeral Rollup.
 *
 * Events come from the PER WebSocket (auction account change subscription).
 * Key property: bid events show that a bid was received but NEVER show amounts.
 * The amounts stay inside the TEE until close_auction reveals the winner.
 */
export const LiveFeed: FC<Props> = ({ events }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-sm font-medium text-gray-200">
            Live Transaction Feed
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="w-2 h-2 bg-teal-500 rounded-full" />
          via Private Ephemeral Rollup
        </div>
      </div>

      {/* Feed */}
      <div className="h-72 overflow-y-auto p-3 space-y-2 font-mono text-xs">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <span className="text-2xl">⛓️</span>
            <span>Waiting for events from the TEE...</span>
          </div>
        ) : (
          events.map((event, i) => (
            <div
              key={i}
              className={`border-l-2 pl-3 pr-2 py-2 rounded-r-lg ${EVENT_COLORS[event.type]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">
                    {EVENT_ICONS[event.type]}
                  </span>
                  <div className="min-w-0">
                    <div className="text-gray-200 truncate">
                      {String(event.data.message ?? event.type)}
                    </div>
                    {event.type === "bid_placed" && (
                      <div className="text-gray-500 text-[10px] mt-0.5">
                        bid #{event.data.bidCount as number} •{" "}
                        <span className="text-yellow-600">
                          amount sealed in TEE
                        </span>
                      </div>
                    )}
                    {event.type === "auction_closed" && (
                      event.data.winner ? (
                        <div className="text-green-400 text-[10px] mt-0.5">
                          winner:{" "}
                          {String(event.data.winner).slice(0, 8)}...
                          {"  "}•{"  "}
                          {(Number(event.data.winningBid) / 1e9).toFixed(4)} SOL
                        </div>
                      ) : (
                        <div className="text-gray-500 text-[10px] mt-0.5">
                          no valid bids above reserve price
                        </div>
                      )
                    )}
                    {!!event.data.slot && (
                      <div className="text-gray-600 text-[10px]">
                        slot {String(event.data.slot)}
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-gray-600 shrink-0">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <p className="text-[10px] text-gray-600">
          Bid amounts are sealed inside the TEE (Intel TDX). Only existence of
          bids is public. Winner is computed by the enclave and committed to L1.
        </p>
      </div>
    </div>
  );
};
