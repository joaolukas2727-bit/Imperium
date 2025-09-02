// api/webhook.js
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  // Verificação do webhook
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // Recebimento de eventos
  if (req.method === "POST") {
    try {
      const data = req.body || {};
      console.log("📩 Webhook recebido:", JSON.stringify(data, null, 2));

      const value = data?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const msg = value?.messages?.[0];

      const from = msg?.from;
      const text = msg?.text?.body;
      console.log("🔎 DEBUG:", {
        hasToken: Boolean(ACCESS_TOKEN),
        phoneNumberId,
        from,
        text
      });

      // Só tenta responder se tem tudo necessário
      if (msg?.type === "text" && phoneNumberId && from && ACCESS_TOKEN) {
        const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: { body: "✅ Recebido!" },
          }),
        });

        const respText = await resp.text();
        console.log("⬆️ Envio de resposta:", resp.status, respText);
      } else {
        console.log("⛔ Não respondeu (faltou algo ou não é texto).");
      }

      return res.status(200).json({ status: "ok" });
    } catch (e) {
      console.error("❌ Erro no webhook:", e);
      return res.status(200).json({ status: "ok" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
