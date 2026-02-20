import { NextRequest } from 'next/server'
import { z } from 'zod'

const requestSchema = z.object({
  domains: z.array(z.string()).min(1).max(30), // Process 30 at a time
})

// Detection patterns
const PAYMENT_PATTERNS: Record<string, { patterns: RegExp[]; name: string }> = {
  stripe: {
    patterns: [/stripe\.com/i, /js\.stripe\.com/i, /checkout\.stripe\.com/i],
    name: 'Stripe',
  },
  paypal: {
    patterns: [/paypal\.com/i, /paypalobjects\.com/i],
    name: 'PayPal',
  },
  square: {
    patterns: [/square\.com/i, /squareup\.com/i],
    name: 'Square',
  },
  braintree: {
    patterns: [/braintree/i, /braintreegateway/i],
    name: 'Braintree',
  },
}

const PSA_PATTERNS: Record<string, { patterns: RegExp[]; name: string }> = {
  connectwise: {
    patterns: [/connectwise/i, /screenconnect/i],
    name: 'ConnectWise',
  },
  autotask: {
    patterns: [/autotask/i],
    name: 'Autotask',
  },
  syncro: {
    patterns: [/syncromsp/i, /syncro/i],
    name: 'Syncro',
  },
  datto: {
    patterns: [/datto\.com/i],
    name: 'Datto',
  },
  kaseya: {
    patterns: [/kaseya/i],
    name: 'Kaseya',
  },
  freshservice: {
    patterns: [/freshservice/i, /freshworks/i],
    name: 'Freshservice',
  },
  zendesk: {
    patterns: [/zendesk/i],
    name: 'Zendesk',
  },
}

function detectPortals(html: string) {
  const paymentPortals: string[] = []
  const psaPortals: string[] = []

  for (const [, config] of Object.entries(PAYMENT_PATTERNS)) {
    if (config.patterns.some(p => p.test(html))) {
      paymentPortals.push(config.name)
    }
  }

  for (const [, config] of Object.entries(PSA_PATTERNS)) {
    if (config.patterns.some(p => p.test(html))) {
      psaPortals.push(config.name)
    }
  }

  return { paymentPortals, psaPortals }
}

async function scrapeDomain(domain: string) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SalesScraper/1.0)',
      },
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    const detection = detectPortals(html)

    return {
      domain,
      status: 'done' as const,
      ...detection,
    }
  } catch (error) {
    return {
      domain,
      status: 'error' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
      paymentPortals: [],
      psaPortals: [],
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { domains } = requestSchema.parse(body)

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < domains.length; i++) {
          const domain = domains[i]

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'processing', domain, index: i })}\n\n`
          ))

          const result = await scrapeDomain(domain)

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'result', ...result, index: i })}\n\n`
          ))
        }

        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'batch_complete' })}\n\n`
        ))

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 }
    )
  }
}
