import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@app/components/chat/CodeBlock'
import { cn } from '@app/lib/utils'

interface StreamingMarkdownProps {
  content: string
  streaming?: boolean
}

export function StreamingMarkdown({ content, streaming }: StreamingMarkdownProps) {
  const [displayContent, setDisplayContent] = useState(content)

  useEffect(() => {
    setDisplayContent(content)
  }, [content])

  return (
    <div className={cn('prose prose-invert max-w-none text-sm', streaming && 'streaming-cursor')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const code = String(children).replace(/\n$/, '')
            if (match) {
              return <CodeBlock code={code} lang={match[1] ?? 'text'} />
            }
            return (
              <code
                className="rounded bg-canvas-inset px-1 py-0.5 font-mono text-[13px]"
                {...props}
              >
                {children}
              </code>
            )
          },
          pre({ children }) {
            return <>{children}</>
          },
          a({ href, children }) {
            return (
              <a href={href} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent" />
      )}
    </div>
  )
}
