"use client";

import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";

loader.config({
  paths: { vs: "/vs" },
});

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface StrategyEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/** Monaco-based Python strategy editor */
export function StrategyEditor({ value, onChange }: StrategyEditorProps) {
  return (
    <div className="h-full w-full">
      <MonacoEditor
        height="100%"
        defaultLanguage="python"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        theme="vs-dark"
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
