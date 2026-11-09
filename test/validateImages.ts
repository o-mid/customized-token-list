import { checkImagesWithBatch, reduceTokens } from './utils'

export const exitCodeForInvalidImages = (invalidCount: number): number => (invalidCount > 0 ? 1 : 0)

const main = async () => {
  const allTokens = reduceTokens('./tokens')
  const results = await checkImagesWithBatch(allTokens)
  const invalidResults = results.filter((result) => !result.exists)
  const exitCode = exitCodeForInvalidImages(invalidResults.length)

  if (exitCode !== 0) {
    console.log(`${invalidResults.length} images are invalid`)
    console.log(
      invalidResults.map((result) => `${result.address} on chain ${result.chainId}`).join('\n')
    )
    process.exit(exitCode)
  }

  console.log('All images are valid')
  process.exit(0)
}

if (process.argv[1]?.includes('validateImages')) {
  main()
}
