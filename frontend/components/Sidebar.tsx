"use client";

import { FileTree } from "./FileTree";

interface SidebarProps {
  onSelectFile?: (path: string) => void;
}

/** Sidebar with project list and file tree */
export function Sidebar({ onSelectFile }: SidebarProps) {
  return (
    <aside className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-900/30">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="font-semibold text-sm">Projects</h2>
        <ul className="mt-2 text-sm text-zinc-400">
          <li className="py-1 cursor-pointer hover:text-zinc-200">Default Project</li>
        </ul>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
          Files
        </h3>
        <FileTree onSelect={onSelectFile} />
      </div>
    </aside>
  );
}
