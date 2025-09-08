// api/webhook.js
import express from "express";
import { processadorMensagemZyra } from "./assistantsRouter.js";

const app = express();
app.use(express.json());

// 🔒 Rota de verificação do Webhook (GET da Meta)
app.get("/api/webhook", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const desafio = req.query["hub.challenge"];

  if (modo === "subscribe" && token === "joaolukas2710") {
    console.log("✅ Webhook verificado com sucesso.");
    return res.status(200).send(desafio);
  } else {
    console.log("❌ Token ou modo inválido na verificação.");
    return res.sendStatus(403);
  }
});

// ✉️ Rota de recebimento de mensagens (POST do WhatsApp)
app.post("/api/webhook", async (req, res) => {
  try {
    const corpo = req.body;
    const entrada = corpo?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!entrada) return res.sendStatus(400);

    const numero = entrada.from;
    const mensagem = entrada.text?.body;

    if (!numero || !mensagem) return res.sendStatus(400);

    console.log(`📩 Mensagem recebida de ${numero}: ${mensagem}`);

    const resposta = await processadorMensagemZyra(numero, mensagem);

    await enviarMensagemWhatsApp(numero, resposta);

    res.sendStatus(200);
  } catch (erro) {
    console.error("❌ Erro no processamento da mensagem:", erro);
    res.sendStatus(500);
  }
});

// 🧪 Simulação de envio de resposta (substituir depois pela integração real)
async function enviarMensagemWhatsApp(numero, mensagem) {
  console.log(`📤 Enviando para ${numero}: ${mensagem}`);
}

// 🚀 Inicialização do servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`🚀 Webhook rodando na porta ${PORTA}`);
});

export default app;
