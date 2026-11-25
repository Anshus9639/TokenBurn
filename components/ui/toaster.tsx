"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: "#141414",
          border: "1px solid #303030",
          color: "#F5F5F5",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.9)",
          fontFamily: "var(--font-geist-sans)",
          fontSize: "13px",
          borderRadius: "10px",
        },
      }}
    />
  );
}
