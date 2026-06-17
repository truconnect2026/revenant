import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.OPENAI_API_KEY ?? "";
const hasKey = API_KEY.length > 0;

// GET — capability probe used by Dashboard to decide whether to show the button
export function GET() {
  return NextResponse.json({ available: hasKey });
}

export async function POST(req: NextRequest) {
  if (!hasKey) {
    return NextResponse.json({ error: "Transcription not configured" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "No audio file" }, { status: 400 });
  }

  try {
    const fd = new FormData();
    fd.append("file", audio as Blob, "clip.webm");
    fd.append("model", "whisper-1");
    fd.append("language", "en");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: fd,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      return NextResponse.json({ error: text }, { status: 502 });
    }

    const result = await resp.json() as { text?: string };
    return NextResponse.json({ text: result.text ?? "" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
