import { NextRequest } from 'next/server'
import { z } from 'zod'

const requestSchema = z.object({
  domains: z.array(z.string()).min(1).max(30),
})

// Payment detection patterns
const PAYMENT_PATTERNS: Record<string, { patterns: RegExp[]; name: string }> = {
  stripe: {
    patterns: [
      /stripe\.com/i,
      /js\.stripe\.com/i,
      /checkout\.stripe\.com/i,
      /stripe\.js/i,
      /Stripe\(/i,
    ],
    name: 'Stripe',
  },
  paypal: {
    patterns: [
      /paypal\.com/i,
      /paypalobjects\.com/i,
      /paypal\.me/i,
      /paypal-button/i,
    ],
    name: 'PayPal',
  },
  square: {
    patterns: [
      /square\.com/i,
      /squareup\.com/i,
      /squarecdn\.com/i,
    ],
    name: 'Square',
  },
  braintree: {
    patterns: [
      /braintree/i,
      /braintreegateway\.com/i,
      /braintree-api/i,
    ],
    name: 'Braintree',
  },
  adyen: {
    patterns: [
      /adyen\.com/i,
      /adyencheckout/i,
    ],
    name: 'Adyen',
  },
  authorize: {
    patterns: [
      /authorize\.net/i,
      /authorizenet/i,
    ],
    name: 'Authorize.net',
  },
  shopify: {
    patterns: [
      /cdn\.shopify\.com/i,
      /checkout\.shopify\.com/i,
    ],
    name: 'Shopify Payments',
  },
}

// PSA detection patterns
const PSA_PATTERNS: Record<string, { patterns: RegExp[]; name: string }> = {
  connectwise: {
    patterns: [
      /connectwise\.com/i,
      /connectwise/i,
      /screenconnect\.com/i,
      /screenconnect/i,
      /manage\.connectwise/i,
    ],
    name: 'ConnectWise',
  },
  autotask: {
    patterns: [
      /autotask\.net/i,
      /autotask\.com/i,
      /autotask/i,
      /datto\.com\/autotask/i,
    ],
    name: 'Autotask',
  },
  syncro: {
    patterns: [
      /syncromsp\.com/i,
      /syncro\.com/i,
      /syncro/i,
    ],
    name: 'Syncro',
  },
  datto: {
    patterns: [
      /datto\.com/i,
      /datto-rmm/i,
      /dattobackup/i,
      /datto/i,
    ],
    name: 'Datto',
  },
  kaseya: {
    patterns: [
      /kaseya\.com/i,
      /kaseya/i,
      /bms\.kaseya/i,
    ],
    name: 'Kaseya',
  },
  ninjarmm: {
    patterns: [
      /ninjarmm\.com/i,
      /ninjaone\.com/i,
      /ninjarmm/i,
      /ninjaone/i,
    ],
    name: 'NinjaRMM',
  },
  freshservice: {
    patterns: [
      /freshservice\.com/i,
      /freshworks\.com/i,
      /freshservice/i,
      /freshdesk/i,
    ],
    name: 'Freshservice',
  },
  zendesk: {
    patterns: [
      /zendesk\.com/i,
      /zdassets\.com/i,
      /zendesk/i,
    ],
    name: 'Zendesk',
  },
  servicenow: {
    patterns: [
      /servicenow\.com/i,
      /service-now\.com/i,
      /servicenow/i,
    ],
    name: 'ServiceNow',
  },
  halopsa: {
    patterns: [
      /halopsa\.com/i,
      /haloitsm\.com/i,
      /halopsa/i,
      /haloitsm/i,
    ],
    name: 'HaloPSA',
  },
  atera: {
    patterns: [
      /atera\.com/i,
      /atera/i,
    ],
    name: 'Atera',
  },
}

function detectPortals(html: string, url: string) {
  const paymentPortals: string[] = []
  const psaPortals: string[] = []

  // Combine HTML and URL for detection
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

async function scrapeDomain(domain: string) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000) // 15s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return {
        domain,
        status: 'error' as const,
        error: `HTTP ${response.status} - ${response.statusText}`,
        paymentPortals: [] as string[],
        psaPortals: [] as string[],
      }
    }

    const html = await response.text()
    const detection = detectPortals(html, response.url)

    return {
      domain,
      status: 'done' as const,
      paymentPortals: detection.paymentPortals,
      psaPortals: detection.psaPortals,
    }
  } catch (error) {
    let errorMessage = 'Unknown error'

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'Timeout - site took too long to respond'
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorMessage = 'Domain not found (DNS error)'
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused'
      } else if (error.message.includes('CERT') || error.message.includes('SSL')) {
        errorMessage = 'SSL/Certificate error'
      } else if (error.message.includes('ECONNRESET')) {
        errorMessage = 'Connection reset by server'
      } else {
        errorMessage = error.message
      }
    }

    return {
      domain,
      status: 'error' as const,
      error: errorMessage,
      paymentPortals: [] as string[],
      psaPortals: [] as string[],
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
