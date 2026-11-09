import pg from 'pg'
import { dbConfig } from './dbconfig.js'

// Um único Pool pro app inteiro — não uma conexão por requisição
export const pool = new pg.Pool(dbConfig(process.env))
