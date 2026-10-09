// Só para o vitest: nenhum teste pode fazer chamada real de rede (APIs pagas). Testes que precisam de fetch o substituem
// com vi.stubGlobal; qualquer fetch "real" falha alto em vez de gastar cota.
globalThis.fetch = (() => { throw new Error('fetch real bloqueado nos testes: use vi.stubGlobal') }) as typeof fetch
