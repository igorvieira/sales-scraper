'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const BATCH_SIZE = 30

interface ScrapeResult {
  domain: string
  status: 'pending' | 'processing' | 'done' | 'error'
  paymentPortals: string[]
  psaPortals: string[]
  error?: string
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

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [domains, setDomains] = useState<string[]>([])
  const [results, setResults] = useState<ScrapeResult[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [totalBatches, setTotalBatches] = useState(0)
  const [error, setError] = useState<string | null>(null)

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

          if (data.type === 'processing') {
            const globalIndex = startIndex + data.index
            setResults(prev => prev.map((r, i) =>
              i === globalIndex ? { ...r, status: 'processing' } : r
            ))
          } else if (data.type === 'result') {
            const globalIndex = startIndex + data.index
            setResults(prev => prev.map((r, i) =>
              i === globalIndex ? {
                domain: data.domain,
                status: data.status,
                paymentPortals: data.paymentPortals,
                psaPortals: data.psaPortals,
                error: data.error,
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
  }

  const downloadResults = () => {
    const csv = [
      ['Domain', 'Status', 'Payment Portals', 'PSA Portals', 'Error'].join(','),
      ...results.map(r => [
        r.domain,
        r.status,
        r.paymentPortals.join('; '),
        r.psaPortals.join('; '),
        r.error || ''
      ].map(v => `"${v}"`).join(','))
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
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold">Sales Scraper</h1>
          <p className="text-muted-foreground">
            Upload a CSV with domains to detect payment and PSA portals
          </p>
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
                        <TableHead>Payment Portals</TableHead>
                        <TableHead>PSA Portals</TableHead>
                        <TableHead>Error</TableHead>
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
                                {result.paymentPortals.map((p, j) => (
                                  <Badge key={j} variant="outline" className="bg-green-50 text-green-700">
                                    {p}
                                  </Badge>
                                ))}
                              </div>
                            ) : result.status === 'done' ? (
                              <span className="text-muted-foreground">None</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {result.status === 'error' ? (
                              <span className="text-muted-foreground">-</span>
                            ) : result.psaPortals.length > 0 ? (
                              <div className="flex gap-1 flex-wrap">
                                {result.psaPortals.map((p, j) => (
                                  <Badge key={j} variant="outline" className="bg-purple-50 text-purple-700">
                                    {p}
                                  </Badge>
                                ))}
                              </div>
                            ) : result.status === 'done' ? (
                              <span className="text-muted-foreground">None</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {result.error ? (
                              <span className="text-sm text-red-600">{result.error}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
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
