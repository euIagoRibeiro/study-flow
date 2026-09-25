import pg from 'pg'

// Um único Pool pro app inteiro — não uma conexão por requisição
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
