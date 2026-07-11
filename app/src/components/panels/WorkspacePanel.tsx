import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export function WorkspacePanel() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']))

  const { data: tree, isLoading } = useQuery({
    queryKey: ['workspace-tree'],
    queryFn: () => apiClient.get<TreeNode>('/api/workspace/tree'),
    retry: false,
  })

  const { data: fileContent, isLoading: fileLoading } = useQuery({
    queryKey: ['workspace-file', selectedPath],
    queryFn: () => apiClient.get<{ content: string }>(`/api/workspace/file`, { path: selectedPath! }),
    enabled: !!selectedPath,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    )
  }

  if (!tree) {
    return (
      <EmptyState
        title="Workspace unavailable"
        description="Connect to the server to browse files."
        className="py-12"
      />
    )
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="w-full shrink-0 overflow-y-auto border-b border-border p-2 md:w-64 md:border-b-0 md:border-r">
        <TreeView
          node={tree}
          expanded={expanded}
          onToggle={(path) => {
            const next = new Set(expanded)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            setExpanded(next)
          }}
          onSelect={setSelectedPath}
          selected={selectedPath}
        />
      </div>
      <div className="flex-1 overflow-auto p-4">
        {selectedPath ? (
          fileLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <pre className="font-mono text-xs text-fg whitespace-pre-wrap">
              {fileContent?.content ?? 'Empty file'}
            </pre>
          )
        ) : (
          <EmptyState title="Select a file" description="Choose a file from the tree to preview." />
        )}
      </div>
    </div>
  )
}

function TreeView({
  node,
  expanded,
  onToggle,
  onSelect,
  selected,
  depth = 0,
}: {
  node: TreeNode
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  selected: string | null
  depth?: number
}) {
  const isDir = node.type === 'dir'
  const isOpen = expanded.has(node.path)

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => {
          if (isDir) onToggle(node.path)
          else onSelect(node.path)
        }}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-canvas-inset ${
          selected === node.path ? 'bg-accent-muted text-accent' : 'text-fg'
        }`}
      >
        {isDir ? (
          isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span className="w-3" />
        )}
        {isDir ? <Folder size={12} /> : <File size={12} />}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && isOpen && node.children?.map((child) => (
        <TreeView
          key={child.path}
          node={child}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          selected={selected}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}
