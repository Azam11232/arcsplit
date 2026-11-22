import { next } from '@vercel/functions'
import { getCspReportOnlyHeaders } from './src/utils/contentSecurityPolicy.js'

export default function middleware() {
  return next({
    headers: getCspReportOnlyHeaders(process.env.VERCEL_ENV),
  })
}
