import { NextRequest } from 'next/server'
import { z } from 'zod'

const requestSchema = z.object({
  domains: z.array(z.string()).min(1).max(30),
})

const CONCURRENT_LIMIT = 5 // Process 5 domains at a time

// Payment detection patterns
const PAYMENT_PATTERNS: Record<string, { patterns: RegExp[]; name: string }> = {
  stripe: {
    patterns: [/stripe\.com/i, /js\.stripe\.com/i, /checkout\.stripe\.com/i, /Stripe\(/i],
    name: 'Stripe',
  },
  paypal: {
    patterns: [/paypal\.com/i, /paypalobjects\.com/i, /paypal\.me/i],
    name: 'PayPal',
  },
  square: {
    patterns: [/square\.com/i, /squareup\.com/i, /squarecdn\.com/i],
    name: 'Square',
  },
  braintree: {
    patterns: [/braintree/i, /braintreegateway\.com/i],
    name: 'Braintree',
  },
  adyen: {
    patterns: [/adyen\.com/i, /adyencheckout/i],
    name: 'Adyen',
  },
  authorize: {
    patterns: [/authorize\.net/i, /authorizenet/i],
    name: 'Authorize.net',
  },
  shopify: {
    patterns: [/cdn\.shopify\.com/i, /checkout\.shopify\.com/i],
    name: 'Shopify Payments',
  },
}

// PSA detection patterns
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
    patterns: [/datto\.com/i, /datto/i],
    name: 'Datto',
  },
  kaseya: {
    patterns: [/kaseya/i],
    name: 'Kaseya',
  },
  ninjarmm: {
    patterns: [/ninjarmm/i, /ninjaone/i],
    name: 'NinjaRMM',
  },
  freshservice: {
    patterns: [/freshservice/i, /freshworks/i, /freshdesk/i],
    name: 'Freshservice',
  },
  zendesk: {
    patterns: [/zendesk/i, /zdassets\.com/i],
    name: 'Zendesk',
  },
  servicenow: {
    patterns: [/servicenow/i, /service-now/i],
    name: 'ServiceNow',
  },
  halopsa: {
    patterns: [/halopsa/i, /haloitsm/i],
    name: 'HaloPSA',
  },
  atera: {
    patterns: [/atera/i],
    name: 'Atera',
  },
}

function detectPortals(html: string, url: string) {
  const paymentPortals: string[] = []
  const psaPortals: string[] = []
  const content = `${html} ${url}`.toLowerCase()

  for (const [, config] of Object.entries(PAYMENT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) {
        if (!paymentPortals.includes(config.name)) {
          paymentPortals.push(config.name)
        }
        break
      }
    }
  }

  for (const [, config] of Object.entries(PSA_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) {
        if (!psaPortals.includes(config.name)) {
          psaPortals.push(config.name)
        }
        break
      }
    }
  }

  return { paymentPortals, psaPortals }
}

async function scrapeDomain(domain: string, index: number) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000) // 8s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return {
        domain,
        index,
        status: 'error' as const,
        error: `HTTP ${response.status}`,
        paymentPortals: [] as string[],
        psaPortals: [] as string[],
      }
    }

    const html = await response.text()
    const detection = detectPortals(html, response.url)

    return {
      domain,
      index,
      status: 'done' as const,
      paymentPortals: detection.paymentPortals,
      psaPortals: detection.psaPortals,
    }
  } catch (error) {
    let errorMessage = 'Unknown error'

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'Timeout'
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorMessage = 'DNS error'
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused'
      } else if (error.message.includes('CERT') || error.message.includes('SSL')) {
        errorMessage = 'SSL error'
      } else if (error.message.includes('ECONNRESET')) {
        errorMessage = 'Connection reset'
      } else {
        errorMessage = error.message.slice(0, 50)
      }
    }

    return {
      domain,
      index,
      status: 'error' as const,
      error: errorMessage,
      paymentPortals: [] as string[],
      psaPortals: [] as string[],
    }
  }
}

// Process domains in parallel chunks
async function* processInParallel(domains: string[]) {
  for (let i = 0; i < domains.length; i += CONCURRENT_LIMIT) {
    const chunk = domains.slice(i, i + CONCURRENT_LIMIT)
    const promises = chunk.map((domain, j) => scrapeDomain(domain, i + j))
    const results = await Promise.all(promises)

    for (const result of results) {
      yield result
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
        for await (const result of processInParallel(domains)) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'result', ...result })}\n\n`
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
