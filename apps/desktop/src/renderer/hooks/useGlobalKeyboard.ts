import { useEffect } from 'react'
import { useAppStore } from '../stores/app-store'

export function useGlobalKeyboard() {
	const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette)
	const toggleTerminal = useAppStore((s) => s.toggleTerminal)

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.metaKey && e.key === 'k') {
				e.preventDefault()
				toggleCommandPalette()
			}
			if (e.ctrlKey && e.key === '`') {
				e.preventDefault()
				toggleTerminal()
			}
		}

		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [toggleCommandPalette, toggleTerminal])
}
