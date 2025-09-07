// ================== INÍCIO DO ARQUIVO ==================
// api/webhook.js
import OpenAI from "openai";
import { google } from "googleapis";
import { consultarGastosPorCategoria } from "./gastos.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- Google Sheets helper --------
async function appendToSheet({ userNumber, userText, aiText, messageId, waStatus, modelUsed, tokens, latency }) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const values = [[
    new Date().toISOString(),
    userNumber || "",
    userText || "",
    aiText || "",
    messageId || "",
    waStatus || "",
    modelUsed || "gpt-4o-mini",
    tokens || "",
    latency || ""
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: "messages!A:I",
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

// --------------------------------------
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
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
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) {
      console.log("Sem mensagens no payload:", JSON.stringify(body));
      return res.status(200).json({ status: "no_message" });
    }

    if (msg.type !== "text" || !msg.text?.body) {
      console.log("Mensagem não-texto ou sem body:", JSON.stringify(msg));
      return res.status(200).json({ status: "ignored_non_text" });
    }

    const userNumber = msg.from;
    const userText = (msg.text.body || "").trim();

    // Caso o usuário pergunte algo como: "quanto gastei este mês com alimentação"
    const matchConsulta = userText.match(/quanto\s+gastei.*?(alimentacao|alimentação|transporte|lazer|moradia|educacao|educação|outros)/i);
    if (matchConsulta) {
      const categoria = matchConsulta[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      try {
        const total = await consultarGastosPorCategoria({ userNumber, categoria, periodo: "mes_atual" });
        const textoResposta = `Você registrou R$ ${total.toFixed(2).replace('.', ',')} em ${categoria} neste mês. Deseja ver o detalhamento por semana ou adicionar outro gasto?`;

        const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
        const payload = {
          messaging_product: "whatsapp",
          to: userNumber,
          type: "text",
          text: { body: textoResposta }
        };

        const r = await fetch(graphUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        await appendToSheet({
          userNumber,
          userText,
          aiText: textoResposta,
          messageId: msg.id,
          waStatus: r.ok ? "sent" : `graph_error_${r.status}`,
          modelUsed: "consulta-direta",
          tokens: "",
          latency: 0
        });

        return res.status(200).json({ status: "sent_consulta_categoria" });
      } catch (e) {
        console.error("Erro ao consultar categoria:", e);
      }
    }

    const systemPrompt = `
Você é a Zyra, assistente financeiro da Zenor.
Missão: ajudar o usuário a decidir rápido e melhor sobre dinheiro, com clareza e inteligência.

Regras:
- Apresente-se apenas na primeira interação.
- Nunca retorne dados financeiros que não sejam do número de quem está enviando a mensagem.
- Sempre use linguagem simples, acessível, objetiva e consultiva.
- Use frases como: "Você registrou R$ X,XX", "Minha recomendação estratégica é...", "Próximos passos (em ordem): ..."

Quando o usuário perguntar por totais, certifique-se de que o dado seja filtrado por número, categoria e período.
Se não for possível garantir a verificação de identidade, diga: "Por segurança, não encontrei registros vinculados ao seu número."
`;

    const t0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    });
    const latencyMs = Date.now() - t0;

    const aiText = completion.choices?.[0]?.message?.content?.trim() ||
      "Tive um problema ao formular a resposta. Pode tentar novamente?";

    const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: userNumber,
      type: "text",
      text: { body: aiText }
    };

    const r = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let waStatus = "sent";
    if (!r.ok) {
      const errText = await r.text();
      console.error("Graph error:", r.status, errText);
      waStatus = `graph_error_${r.status}`;
    }

    try {
      await appendToSheet({
        userNumber,
        userText,
        aiText,
        messageId: msg.id,
        waStatus,
        modelUsed: "gpt-4o-mini",
        tokens: "",
        latency: latencyMs
      });
    } catch (logErr) {
      console.error("Falha ao registrar no Sheets:", logErr);
    }

    if (!r.ok) {
      return res.status(200).json({ status: "graph_error" });
    }

    console.log("Mensagem enviada com sucesso para:", userNumber);
    return res.status(200).json({ status: "sent" });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(200).json({ status: "error", message: String(e) });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb"
    }
  }
};
// ================== FIM DO ARQUIVO ==================
