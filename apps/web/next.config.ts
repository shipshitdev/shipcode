import type { NextConfig } from 'next'

const config: NextConfig = {
	transpilePackages: ['@shipcode/shared'],
	output: 'export',
}

export default config
