// api/webhook.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Dica: mantenha essas variáveis já existentes na Vercel
// ACCESS_TOKEN: token do WhatsApp Graph
// PHONE_NUMBER_ID: ID do número do WhatsApp Business (ex.: 123456789012345)
// VERIFY_TOKEN: o mesmo usado no setup do webhook (para GET de verificação)

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // Verificação do webhook do Meta (challenge)
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    // Navega no payload do WhatsApp
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    // Ignore se não houver mensagem de texto do usuário
    if (!msg || msg.type !== "text") {
      return res.status(200).json({ status: "ignored" });
    }

    const userNumber = msg.from; // WhatsApp ID do remetente
    const userText = msg.text?.body?.trim() ?? "";

    // Prompt do Jarvis (tom Imperium, PT-BR, respostas objetivas)
    const instructions = [
      "Você é o Jarvis, assistente financeiro do Imperium.",
      "Fale em PT-BR, objetivo, elegante e claro.",
      "Se o assunto for finanças pessoais/negócios, dê passos práticos.",
      "Não invente links. Se não souber, diga brevemente o que precisa para ajudar.",
    ].join(" ");

    // Chamada à OpenAI (Responses API – recomendada)
    const ai = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions,
      input: `Usuário (${userNumber}): ${userText}`,
      max_output_tokens: 400, // contém custo
      temperature: 0.4,
    });

    const aiText =
      ai.output_text?.trim() ||
      "Tive um problema técnico ao formular a resposta. Pode tentar novamente?";

    // Envia a resposta de volta pelo Graph
    const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: userNumber,
      type: "text",
      text: { body: aiText },
    };

    const r = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Graph error:", r.status, err);
      // Mesmo com erro no envio, respondemos 200 para o Meta não re-tentar indefinidamente
      return res.status(200).json({ status: "graph_error", detail: err });
    }

    return res.status(200).json({ status: "sent" });
  } catch (e) {
    console.error("Webhook error:", e);
    // Respondemos 200 para evitar reentrega em loop
    return res.status(200).json({ status: "error", message: String(e) });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};
