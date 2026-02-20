import { NextRequest } from 'next/server'
import { z } from 'zod'
import FirecrawlApp from '@mendable/firecrawl-js'

const requestSchema = z.object({
  domains: z.array(z.string()).min(1).max(30),
})

const CONCURRENT_LIMIT = 5

const firecrawl = process.env.FIRECRAWL_API_KEY
  ? new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY })
  : null

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
    patterns: [/cdn\.shopify\.com/i, /checkout\.shopify\.com/i, /shopify/i],
    name: 'Shopify Payments',
  },
  woocommerce: {
    patterns: [/woocommerce/i, /wc-ajax/i],
    name: 'WooCommerce',
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

// Tech stack patterns
const TECH_PATTERNS: Record<string, { patterns: RegExp[]; name: string; category: string }> = {
  react: { patterns: [/react/i, /_reactRootContainer/i], name: 'React', category: 'Frontend' },
  vue: { patterns: [/vue\.js/i, /vue@/i], name: 'Vue.js', category: 'Frontend' },
  angular: { patterns: [/angular/i, /ng-version/i], name: 'Angular', category: 'Frontend' },
  jquery: { patterns: [/jquery/i], name: 'jQuery', category: 'Frontend' },
  wordpress: { patterns: [/wp-content/i, /wp-includes/i], name: 'WordPress', category: 'CMS' },
  shopify: { patterns: [/cdn\.shopify\.com/i, /myshopify/i], name: 'Shopify', category: 'CMS' },
  wix: { patterns: [/wix\.com/i, /wixstatic/i], name: 'Wix', category: 'CMS' },
  squarespace: { patterns: [/squarespace/i], name: 'Squarespace', category: 'CMS' },
  webflow: { patterns: [/webflow/i], name: 'Webflow', category: 'CMS' },
  hubspot: { patterns: [/hubspot/i, /hs-scripts/i], name: 'HubSpot', category: 'Marketing' },
  intercom: { patterns: [/intercom/i], name: 'Intercom', category: 'Support' },
  drift: { patterns: [/drift\.com/i], name: 'Drift', category: 'Support' },
  googleanalytics: { patterns: [/google-analytics/i, /gtag/i, /googletagmanager/i], name: 'Google Analytics', category: 'Analytics' },
  hotjar: { patterns: [/hotjar/i], name: 'Hotjar', category: 'Analytics' },
  cloudflare: { patterns: [/cloudflare/i], name: 'Cloudflare', category: 'Infrastructure' },
  aws: { patterns: [/amazonaws\.com/i, /cloudfront\.net/i], name: 'AWS', category: 'Infrastructure' },
}

function extractMetadata(html: string) {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  const description = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() ||
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)?.[1]?.trim() || ''

  // Extract emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const emails = [...new Set(html.match(emailRegex) || [])].slice(0, 5)

  // Extract phone numbers
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g
  const phones = [...new Set(html.match(phoneRegex) || [])].slice(0, 5)

  // Extract social links
  const socialPatterns = {
    linkedin: /linkedin\.com\/(?:company|in)\/([^"'\s/?]+)/i,
    twitter: /(?:twitter|x)\.com\/([^"'\s/?]+)/i,
    facebook: /facebook\.com\/([^"'\s/?]+)/i,
    instagram: /instagram\.com\/([^"'\s/?]+)/i,
  }

  const socialLinks: Record<string, string> = {}
  for (const [platform, pattern] of Object.entries(socialPatterns)) {
    const match = html.match(pattern)
    if (match) {
      socialLinks[platform] = match[0]
    }
  }

  return { title, description, emails, phones, socialLinks }
}

function detectPortals(content: string) {
  const paymentPortals: string[] = []
  const psaPortals: string[] = []
  const techStack: Array<{ name: string; category: string }> = []
  const lowerContent = content.toLowerCase()

  for (const [, config] of Object.entries(PAYMENT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lowerContent)) {
        if (!paymentPortals.includes(config.name)) {
          paymentPortals.push(config.name)
        }
        break
      }
    }
  }

  for (const [, config] of Object.entries(PSA_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lowerContent)) {
        if (!psaPortals.includes(config.name)) {
          psaPortals.push(config.name)
        }
        break
      }
    }
  }

  for (const [, config] of Object.entries(TECH_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lowerContent)) {
        if (!techStack.find(t => t.name === config.name)) {
          techStack.push({ name: config.name, category: config.category })
        }
        break
      }
    }
  }

  return { paymentPortals, psaPortals, techStack }
}

async function scrapeWithFirecrawl(domain: string, index: number) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const result = await firecrawl!.scrape(url, {
      formats: ['html'],
      timeout: 15000,
    })

    const html = result.html || ''
    const detection = detectPortals(html)
    const metadata = extractMetadata(html)

    return {
      domain,
      index,
      status: 'done' as const,
      paymentPortals: detection.paymentPortals,
      psaPortals: detection.psaPortals,
      details: {
        title: metadata.title,
        description: metadata.description,
        emails: metadata.emails,
        phones: metadata.phones,
        socialLinks: metadata.socialLinks,
        techStack: detection.techStack,
        scrapedAt: new Date().toISOString(),
        scraper: 'firecrawl',
      },
    }
  } catch (error) {
    return {
      domain,
      index,
      status: 'error' as const,
      error: error instanceof Error ? error.message.slice(0, 50) : 'Firecrawl error',
      paymentPortals: [] as string[],
      psaPortals: [] as string[],
      details: null,
    }
  }
}

async function scrapeWithFetch(domain: string, index: number) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

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
        details: null,
      }
    }

    const html = await response.text()
    const detection = detectPortals(html)
    const metadata = extractMetadata(html)

    return {
      domain,
      index,
      status: 'done' as const,
      paymentPortals: detection.paymentPortals,
      psaPortals: detection.psaPortals,
      details: {
        title: metadata.title,
        description: metadata.description,
        emails: metadata.emails,
        phones: metadata.phones,
        socialLinks: metadata.socialLinks,
        techStack: detection.techStack,
        scrapedAt: new Date().toISOString(),
        scraper: 'fetch',
      },
    }
  } catch (error) {
    let errorMessage = 'Unknown error'
    if (error instanceof Error) {
      if (error.name === 'AbortError') errorMessage = 'Timeout'
      else if (error.message.includes('ENOTFOUND')) errorMessage = 'DNS error'
      else if (error.message.includes('ECONNREFUSED')) errorMessage = 'Connection refused'
      else if (error.message.includes('CERT') || error.message.includes('SSL')) errorMessage = 'SSL error'
      else errorMessage = error.message.slice(0, 50)
    }

    return {
      domain,
      index,
      status: 'error' as const,
      error: errorMessage,
      paymentPortals: [] as string[],
      psaPortals: [] as string[],
      details: null,
    }
  }
}

async function scrapeDomain(domain: string, index: number) {
  if (firecrawl) {
    return scrapeWithFirecrawl(domain, index)
  }
  return scrapeWithFetch(domain, index)
}

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
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'info', scraper: firecrawl ? 'firecrawl' : 'fetch' })}\n\n`
        ))

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
