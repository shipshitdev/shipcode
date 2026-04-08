import type { Metadata } from 'next'
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import type { ComponentType, ReactNode } from 'react'

import { useMDXComponents } from '../../mdx-components'

type PageProps = {
  params: Promise<{ mdxPath?: string[] }>
}

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params
  const { metadata } = await importPage(resolvedParams.mdxPath ?? [])

  return metadata
}

export default async function CatchAllDocsPage({ params }: PageProps) {
  const resolvedParams = await params
  const { default: MDXContent, metadata, toc } = await importPage(
    resolvedParams.mdxPath ?? []
  )
  const Wrapper = useMDXComponents().wrapper as ComponentType<{
    children: ReactNode
    metadata: typeof metadata
    toc: typeof toc
  }>

  return (
    <Wrapper metadata={metadata} toc={toc}>
      <MDXContent params={resolvedParams} />
    </Wrapper>
  )
}
