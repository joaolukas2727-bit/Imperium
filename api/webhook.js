// api/webhook.js
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  // 1) Verificação do webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // 2) Recebimento de eventos (POST)
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
        text,
        type: msg?.type
      });

      // Só tenta responder se temos tudo necessário
      if (msg?.type === "text" && phoneNumberId && from && ACCESS_TOKEN) {
        // 2.1 Tenta responder texto livre (dentro da janela de 24h)
        const sendFree = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
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

        const freeText = await sendFree.text();
        console.log("⬆️ Envio texto livre:", sendFree.status, freeText);

        // 2.2 Se fora da janela (erro 131000), faz fallback com TEMPLATE "teste"
        if (!sendFree.ok && freeText.includes('"code":131000')) {
          const sendTpl = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              type: "template",
              template: {
                name: "teste",           // seu template aprovado
                language: { code: "pt_BR" }
              }
            }),
          });
          const tplText = await sendTpl.text();
          console.log("⬆️ Envio TEMPLATE:", sendTpl.status, tplText);
        }
      } else {
        console.log("⛔ Não respondeu (faltou token/ID/from ou não é texto).");
      }

      return res.status(200).json({ status: "ok" });
    } catch (e) {
      console.error("❌ Erro no webhook:", e);
      return res.status(200).json({ status: "ok" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}

