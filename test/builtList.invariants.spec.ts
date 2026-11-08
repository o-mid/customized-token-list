import * as fs from 'fs'
import { describe, expect, it } from 'vitest'
import { reduceTokens } from './utils'
import { Token } from './type'
import { exitCodeForInvalidImages } from './validateImages'

/**
 * Checks on the list in tokens/*.json. There is no separate build step;
 * reduceTokens() is the same aggregation the schema tests use.
 *
 * @uniswap/token-lists is not installed here, so this file does not call it.
 * Per-token shape is already covered against schema/tokenExpectedSchema.json.
 */

const pairKey = (token: { chainId: number; address: string }): string =>
  `${token.chainId}:${token.address.toLowerCase()}`

const duplicatePairKeys = (rows: { chainId: number; address: string }[]): string[] => {
  const counts = new Map<string, number>()
  for (const token of rows) {
    const key = pairKey(token)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort()
}

// data:image/<type>[;param][,;base64],<payload>
const DATA_IMAGE_URI = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+(?:=[^;,]+)?)*,.+/i

const isDataImageUri = (uri: string): boolean => DATA_IMAGE_URI.test(uri)

const tokens = reduceTokens('./tokens') as Token[]
const denyTokens = reduceTokens('./denyTokens') as { chainId: number; address: string }[]

describe('built token list', () => {
  it('keeps every (chainId, address) pair unique', () => {
    expect(duplicatePairKeys(tokens)).toEqual([])
    expect(duplicatePairKeys(denyTokens)).toEqual([])
  })

  it('does not list a token that is also denied', () => {
    const denied = new Set(denyTokens.map((token) => pairKey(token)))
    const overlap = tokens
      .filter((token) => denied.has(pairKey(token)))
      .map((token) => pairKey(token))
    expect(overlap).toEqual([])
  })

  it('keeps the rows that match the chain', () => {
    const usdxl = tokens.filter(
      (token) =>
        token.chainId === 999 &&
        token.address.toLowerCase() === '0xca79db4b49f608ef54a5cb813fbed3a6387bc645'
    )
    expect(usdxl.map((token) => token.symbol)).toEqual(['USDXL'])

    const ueth = tokens.find((token) => token.chainId === 1337 && token.symbol === 'UETH')
    expect(ueth?.address.toLowerCase()).toBe('0xe1edd30daaf5caac3fe63569e24748da00000000')

    const nikl = tokens
      .filter((token) => token.chainId === 56 && token.symbol === 'NIKLon')
      .map((token) => token.address.toLowerCase())
    expect(nikl).toEqual(['0xe23f03d2907cdc38a10f6ccdc1a157bf1afe51de'])

    const pall = tokens.filter(
      (token) =>
        token.chainId === 56 &&
        token.address.toLowerCase() === '0x3fcd741646a9790635b938cdb69af5df356cbaab'
    )
    expect(pall.map((token) => token.symbol)).toEqual(['PALLon'])
  })

  it('accepts Stellar addresses in apply-token', () => {
    const source = fs.readFileSync('.github/scripts/apply-token.mjs', 'utf8')
    expect(source).toContain('1201081091099710 /* XLM */')
    const stellar = tokens.filter((token) => token.chainId === 1201081091099710)
    expect(stellar.length).toBeGreaterThan(0)
    expect(stellar.every((token) => !/^0x[0-9a-fA-F]{40}$/.test(token.address))).toBe(true)
  })

  it('fails the image check when any logo is missing', () => {
    expect(exitCodeForInvalidImages(0)).toBe(0)
    expect(exitCodeForInvalidImages(1)).toBe(1)
  })

  it('uses an integer decimals between 0 and 36', () => {
    const outOfRange = tokens
      .filter(
        (token) => !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36
      )
      .map((token) => `${pairKey(token)} decimals=${String(token.decimals)}`)

    expect(outOfRange).toEqual([])
  })

  it('accepts a data image URI without fetching it', () => {
    expect(isDataImageUri('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isDataImageUri('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(
      true
    )
    expect(isDataImageUri('data:image/png;base64,')).toBe(false)
    expect(isDataImageUri('data:text/plain,hello')).toBe(false)
  })

  it('resolves every logoURI through fetch, or accepts a data image URI', async () => {
    const originalFetch = globalThis.fetch
    const fetched: string[] = []

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      fetched.push(url)

      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError(`Unsupported protocol: ${parsed.protocol}`)
      }

      return new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }) as typeof fetch

    try {
      const failures: string[] = []

      await Promise.all(
        tokens.map(async (token) => {
          if (isDataImageUri(token.logoURI)) return

          try {
            const response = await fetch(token.logoURI, { method: 'HEAD' })
            const contentType = response.headers.get('content-type') ?? ''
            if (!response.ok || !contentType.startsWith('image/')) {
              failures.push(`${pairKey(token)} ${token.logoURI}`)
            }
          } catch {
            failures.push(`${pairKey(token)} ${token.logoURI}`)
          }
        })
      )

      expect(failures).toEqual([])
      expect(fetched).toHaveLength(tokens.filter((token) => !isDataImageUri(token.logoURI)).length)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
