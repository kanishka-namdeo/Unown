import { NextResponse } from "next/server";
import { STARTER_TEMPLATES, getTemplate } from "@/lib/sigil/templates";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const template = getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json(template);
  }
  return NextResponse.json({ templates: STARTER_TEMPLATES });
}
