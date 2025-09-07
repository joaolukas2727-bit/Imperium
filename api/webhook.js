// api/webhook.js
import express from "express";
import { processarMensagemZyra } from "./assistantsRouter.js";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Extrai número e mensagem do WhatsApp
    const entrada = body?.messages?.[0];
    if (!entrada) return res.sendStatus(400);

    const numero = entrada.from;            // Ex: 5534999999999
    const mensagem = entrada.text?.body;    // Mensagem de texto

    if (!numero || !mensagem) return res.sendStatus(400);

    console.log(`📩 Mensagem recebida de ${numero}: ${mensagem}`);

    // 🔁 Chama a Zyra (Assistants API)
    const resposta = await processarMensagemZyra(numero, mensagem);

    // Envia a resposta de volta pelo seu método preferido (ex: WhatsApp API)
    await enviarMensagemWhatsApp(numero, resposta);

    res.sendStatus(200);

  } catch (erro) {
    console.error("❌ Erro no webhook:", erro);
    res.sendStatus(500);
  }
});

// Mock temporário para testes locais — substitua pelo seu método real
async function enviarMensagemWhatsApp(numero, mensagem) {
  console.log(`💬 Enviando para ${numero}: ${mensagem}`);
  // Aqui você conecta com sua API de envio real (Meta/360Dialog/Gupshup/etc.)
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor webhook rodando na porta ${PORT}`);
});
