"use client";

import type { ProjectFile } from "@shared/types";

/** Placeholder file tree - mock structure */
const MOCK_FILES: ProjectFile[] = [
  {
    name: "strategy.py",
    path: "strategy.py",
    type: "file",
  },
  {
    name: "indicators",
    path: "indicators",
    type: "directory",
    children: [
      { name: "sma.py", path: "indicators/sma.py", type: "file" },
      { name: "rsi.py", path: "indicators/rsi.py", type: "file" },
    ],
  },
];

interface FileTreeProps {
  onSelect?: (path: string) => void;
}

function FileNode({
  file,
  onSelect,
  depth = 0,
}: {
  file: ProjectFile;
  onSelect?: (path: string) => void;
  depth?: number;
}) {
  const isDir = file.type === "directory";
  return (
    <div className="select-none">
      <div
        className="flex items-center gap-2 py-1 px-2 rounded text-sm hover:bg-zinc-800 cursor-pointer"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => !isDir && onSelect?.(file.path)}
      >
        <span className="text-zinc-500">{isDir ? "📁" : "📄"}</span>
        <span>{file.name}</span>
      </div>
      {isDir &&
        file.children?.map((child) => (
          <FileNode
            key={child.path}
            file={child}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export function FileTree({ onSelect }: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {MOCK_FILES.map((f) => (
        <FileNode key={f.path} file={f} onSelect={onSelect} />
      ))}
    </div>
  );
}
