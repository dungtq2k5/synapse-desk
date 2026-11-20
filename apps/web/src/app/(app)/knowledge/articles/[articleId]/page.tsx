import type { Metadata } from 'next';
import { ArticleReader } from '@/components/knowledge/article-reader';

export const metadata: Metadata = { title: 'Article · SynapseDesk' };

/** One article; `?passage=` opens it at a cited passage. */
export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{ passage?: string | string[] }>;
}) {
  const { articleId } = await params;
  const { passage } = await searchParams;
  return (
    <ArticleReader
      key={`${articleId}:${String(passage)}`}
      articleId={articleId}
      passage={typeof passage === 'string' ? passage : undefined}
    />
  );
}
