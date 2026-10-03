// /src/app/api/analyze-document/route.ts
import { analyzeDocumentAction } from '@/app/actions';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import type { NextApiRequest } from 'next';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper to convert stream to buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err: any) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('document') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(fileBuffer);
    const dataUri = `data:${file.type};base64,${buffer.toString('base64')}`;

    const result = await analyzeDocumentAction({ documentDataUri: dataUri });

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(result, { status: 400 });
    }
  } catch (error: any) {
    console.error('API Error in analyze-document:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
