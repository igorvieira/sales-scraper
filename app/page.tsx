'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const BATCH_SIZE = 30

interface ScrapeDetails {
  title: string
  description: string
  emails: string[]
  phones: string[]
  socialLinks: Record<string, string>
  techStack: Array<{ name: string; category: string }>
  scrapedAt: string
  scraper: string
}

interface ScrapeResult {
  domain: string
  status: 'pending' | 'processing' | 'done' | 'error'
  paymentPortals: string[]
  psaPortals: string[]
  error?: string
  details?: ScrapeDetails | null
}

function parseCSV(content: string): string[] {
  const lines = content.split(/[\r\n]+/).filter(Boolean)
  const domains: string[] = []
  const domainRegex = /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}/

  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''))
    for (const part of parts) {
      if (part && domainRegex.test(part)) {
        let domain = part.toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0]
        domains.push(domain)
        break
      }
    }
  }

  return [...new Set(domains)]
}

function DetailsDialog({ result }: { result: ScrapeResult }) {
  if (!result.details) return null

  const { title, description, emails, phones, socialLinks, techStack, scrapedAt, scraper } = result.details

  const groupedTech = techStack.reduce((acc, tech) => {
    if (!acc[tech.category]) acc[tech.category] = []
    acc[tech.category].push(tech.name)
    return acc
  }, {} as Record<string, string[]>)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Details</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {result.domain}
            <Badge variant="outline" className="text-xs">{scraper}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">PAGE INFO</h3>
            <div className="space-y-2">
              {title && (
                <div>
                  <span className="text-xs text-muted-foreground">Title</span>
                  <p className="text-sm">{title}</p>
                </div>
              )}
              {description && (
                <div>
                  <span className="text-xs text-muted-foreground">Description</span>
                  <p className="text-sm">{description.slice(0, 200)}{description.length > 200 ? '...' : ''}</p>
                </div>
              )}
            </div>
          </section>

          {/* Payment Portals */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">PAYMENT PORTALS</h3>
            {result.paymentPortals.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {result.paymentPortals.map((p, i) => (
                  <Badge key={i} className="bg-green-100 text-green-800">{p}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None detected</p>
            )}
          </section>

          {/* PSA Portals */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">PSA PORTALS</h3>
            {result.psaPortals.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {result.psaPortals.map((p, i) => (
                  <Badge key={i} className="bg-purple-100 text-purple-800">{p}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None detected</p>
            )}
          </section>

          {/* Tech Stack */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">TECH STACK</h3>
            {Object.keys(groupedTech).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(groupedTech).map(([category, techs]) => (
                  <div key={category}>
                    <span className="text-xs text-muted-foreground">{category}</span>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {techs.map((tech, i) => (
                        <Badge key={i} variant="outline">{tech}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None detected</p>
            )}
          </section>

          {/* Contact Info */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">CONTACT INFO</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-muted-foreground">Emails</span>
                {emails.length > 0 ? (
                  <ul className="text-sm space-y-1 mt-1">
                    {emails.map((email, i) => (
                      <li key={i} className="font-mono text-xs">{email}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None found</p>
                )}
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Phones</span>
                {phones.length > 0 ? (
                  <ul className="text-sm space-y-1 mt-1">
                    {phones.map((phone, i) => (
                      <li key={i} className="font-mono text-xs">{phone}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None found</p>
                )}
              </div>
            </div>
          </section>

          {/* Social Links */}
          <section>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">SOCIAL LINKS</h3>
            {Object.keys(socialLinks).length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(socialLinks).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url.startsWith('http') ? url : `https://${url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Badge variant="outline" className="capitalize hover:bg-muted cursor-pointer">
                      {platform}
                    </Badge>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None found</p>
            )}
          </section>

          {/* Metadata */}
          <section className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Scraped at {new Date(scrapedAt).toLocaleString()}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [domains, setDomains] = useState<string[]>([])
  const [results, setResults] = useState<ScrapeResult[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [totalBatches, setTotalBatches] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [scraperType, setScraperType] = useState<string>('')

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setError(null)
    const content = await selectedFile.text()
    const parsed = parseCSV(content)

    if (parsed.length === 0) {
      setError('No valid domains found')
      return
    }

    if (parsed.length > 300) {
      setError(`Found ${parsed.length} domains. Maximum is 300.`)
      return
    }

    setFile(selectedFile)
    setDomains(parsed)
    setResults(parsed.map(d => ({ domain: d, status: 'pending', paymentPortals: [], psaPortals: [] })))
    setTotalBatches(Math.ceil(parsed.length / BATCH_SIZE))
  }, [])

  const processBatch = async (batchDomains: string[], startIndex: number) => {
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: batchDomains }),
    })

    if (!response.ok) {
      throw new Error('Failed to process batch')
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))

          if (data.type === 'info') {
            setScraperType(data.scraper)
          } else if (data.type === 'result') {
            const globalIndex = startIndex + data.index
            setResults(prev => prev.map((r, i) =>
              i === globalIndex ? {
                domain: data.domain,
                status: data.status,
                paymentPortals: data.paymentPortals || [],
                psaPortals: data.psaPortals || [],
                error: data.error,
                details: data.details,
              } : r
            ))
          }
        }
      }
    }
  }

  const startScraping = async () => {
    if (domains.length === 0) return

    setIsProcessing(true)
    setCurrentBatch(0)

    try {
      const batches = []
      for (let i = 0; i < domains.length; i += BATCH_SIZE) {
        batches.push(domains.slice(i, i + BATCH_SIZE))
      }

      for (let i = 0; i < batches.length; i++) {
        setCurrentBatch(i + 1)
        await processBatch(batches[i], i * BATCH_SIZE)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClear = () => {
    setFile(null)
    setDomains([])
    setResults([])
    setCurrentBatch(0)
    setTotalBatches(0)
    setError(null)
    setScraperType('')
  }

  const downloadResults = () => {
    const csv = [
      ['Domain', 'Status', 'Payment Portals', 'PSA Portals', 'Tech Stack', 'Emails', 'Phones', 'Title', 'Error'].join(','),
      ...results.map(r => [
        r.domain,
        r.status,
        r.paymentPortals.join('; '),
        r.psaPortals.join('; '),
        r.details?.techStack.map(t => t.name).join('; ') || '',
        r.details?.emails.join('; ') || '',
        r.details?.phones.join('; ') || '',
        r.details?.title || '',
        r.error || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'scrape-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const stats = {
    total: results.length,
    done: results.filter(r => r.status === 'done').length,
    errors: results.filter(r => r.status === 'error').length,
    withPayment: results.filter(r => r.paymentPortals.length > 0).length,
    withPSA: results.filter(r => r.psaPortals.length > 0).length,
  }

  const progress = stats.total > 0 ? ((stats.done + stats.errors) / stats.total) * 100 : 0

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Sales Scraper</h1>
            <p className="text-muted-foreground">
              Upload a CSV with domains to detect payment and PSA portals
            </p>
          </div>
          {scraperType && (
            <Badge variant="outline" className="text-xs">
              Using {scraperType === 'firecrawl' ? 'Firecrawl' : 'Basic Fetch'}
            </Badge>
          )}
        </header>

        {/* Upload Section */}
        {!isProcessing && results.every(r => r.status === 'pending') && (
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV</CardTitle>
              <CardDescription>
                One domain per line. Maximum 300 domains (processed in batches of {BATCH_SIZE}).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-4 items-center">
                <Label htmlFor="csv-file" className="cursor-pointer">
                  <Input
                    id="csv-file"
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button variant="outline" asChild>
                    <span>{file ? file.name : 'Choose File'}</span>
                  </Button>
                </Label>

                {domains.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {domains.length} domains ({totalBatches} batches)
                    </span>
                    <Button onClick={startScraping}>
                      Start Scraping
                    </Button>
                  </>
                )}
              </div>

              {domains.length > 0 && (
                <div className="bg-muted p-3 rounded-md max-h-32 overflow-y-auto">
                  <ul className="text-sm font-mono space-y-1">
                    {domains.slice(0, 5).map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                    {domains.length > 5 && (
                      <li className="text-muted-foreground">...and {domains.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Progress Section */}
        {(isProcessing || results.some(r => r.status !== 'pending')) && (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-4">
                  <Progress value={progress} className="w-64" />
                  <span className="text-sm text-muted-foreground">
                    {stats.done + stats.errors} / {stats.total}
                    {isProcessing && ` (Batch ${currentBatch}/${totalBatches})`}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {!isProcessing && (
                  <>
                    <Button variant="outline" onClick={handleClear}>
                      New Scan
                    </Button>
                    <Button onClick={downloadResults}>
                      Download CSV
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-green-600">{stats.done}</div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-red-600">{stats.errors}</div>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-blue-600">{stats.withPayment}</div>
                  <p className="text-xs text-muted-foreground">With Payment</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-purple-600">{stats.withPSA}</div>
                  <p className="text-xs text-muted-foreground">With PSA</p>
                </CardContent>
              </Card>
            </div>

            {/* Results Table */}
            <Card>
              <CardContent className="pt-6">
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>PSA</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((result, i) => (
                        <TableRow key={i} className={result.status === 'error' ? 'bg-red-50' : ''}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono text-sm">{result.domain}</TableCell>
                          <TableCell>
                            <Badge variant={
                              result.status === 'done' ? 'outline' :
                              result.status === 'error' ? 'destructive' :
                              result.status === 'processing' ? 'default' :
                              'secondary'
                            }>
                              {result.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {result.status === 'error' ? (
                              <span className="text-muted-foreground">-</span>
                            ) : result.paymentPortals.length > 0 ? (
                              <div className="flex gap-1 flex-wrap">
                                {result.paymentPortals.slice(0, 2).map((p, j) => (
                                  <Badge key={j} variant="outline" className="bg-green-50 text-green-700 text-xs">
                                    {p}
                                  </Badge>
                                ))}
                                {result.paymentPortals.length > 2 && (
                                  <Badge variant="outline" className="text-xs">+{result.paymentPortals.length - 2}</Badge>
                                )}
                              </div>
                            ) : result.status === 'done' ? (
                              <span className="text-muted-foreground text-sm">None</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {result.status === 'error' ? (
                              <span className="text-muted-foreground">-</span>
                            ) : result.psaPortals.length > 0 ? (
                              <div className="flex gap-1 flex-wrap">
                                {result.psaPortals.slice(0, 2).map((p, j) => (
                                  <Badge key={j} variant="outline" className="bg-purple-50 text-purple-700 text-xs">
                                    {p}
                                  </Badge>
                                ))}
                                {result.psaPortals.length > 2 && (
                                  <Badge variant="outline" className="text-xs">+{result.psaPortals.length - 2}</Badge>
                                )}
                              </div>
                            ) : result.status === 'done' ? (
                              <span className="text-muted-foreground text-sm">None</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {result.error ? (
                              <span className="text-xs text-red-600">{result.error}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {result.status === 'done' && result.details && (
                              <DetailsDialog result={result} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  )
}
