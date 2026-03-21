"use client";

import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { MAGIC_ROUTER_RPC } from "@/lib/constants";

require("@solana/wallet-adapter-react-ui/styles.css");

/**
 * Uses the Magic Router as the default RPC endpoint.
 * The router automatically forwards transactions to L1 or PER based on
 * whether the target accounts are delegated — no manual layer switching needed.
 */
export const AppWalletProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={MAGIC_ROUTER_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
