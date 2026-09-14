import { receiveFakeUpload, serveFakeFile } from '@/lib/providers/storage/fake'

// Development's stand-in for Supabase Storage's signed links, for STORAGE_PROVIDER=fake. The token
// is the only credential, as it is there. Production answers 404.

interface Context {
  params: Promise<{ token: string }>
}

export async function PUT(request: Request, { params }: Context): Promise<Response> {
  return receiveFakeUpload((await params).token, request)
}

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  return serveFakeFile((await params).token)
}
