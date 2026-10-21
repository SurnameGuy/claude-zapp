# Zapp

- PC FUNCIONANDO
- APK/MOBILE COM ERROS, AINDA NÃO FUNCIONANDO

Cliente para o recurso **Aparelhos conectados** do WhatsApp, com visual de iPhone. Roda como **app Android (APK)**: o servidor
(Node.js + Baileys) vai embutido dentro do app, então **não precisa de Termux, terminal ou computador ligado**.

## 1) Gerar o APK (sem instalar nada no seu computador)

1. Crie uma conta gratuita em github.com e um repositório novo (pode ser **privado**).
2. Envie **todo o conteúdo desta pasta** para o repositório (botão *Add file → Upload files*, arrastando a pasta descompactada).
   Confira que a pasta oculta `.github` foi junto.
3. Abra a aba **Actions**. A compilação começa sozinha (leva ~10 minutos na primeira vez).
4. Quando terminar, baixe o APK em **Releases → “Zapp (última versão)” → Zapp.apk**
   (ou em Actions → execução → *Artifacts → Zapp-apk*).

Toda vez que você enviar arquivos novos ao repositório, um novo APK é gerado. O APK é assinado sempre com a mesma chave,
então **instalar por cima mantém o seu login**.

## 2) Instalar e usar

1. No celular, abra o `Zapp.apk` e permita “instalar apps desconhecidos” quando o Android pedir.
2. Abra o Zapp, toque em **Concordar e continuar**, digite seu número (com DDD) e toque **Avançar**.
3. No WhatsApp do celular: **Configurações → Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone**
   e digite o código de 8 caracteres que aparece no Zapp. O histórico e os nomes chegam em alguns minutos.
4. Para receber notificações com o app fechado e após reiniciar o celular:
   - permita as **notificações** (o app pede na primeira abertura);
   - em **Ajustes → Notificações → Manter ativo em segundo plano**, remova a restrição de bateria;
   - em Xiaomi/Samsung/Huawei/Oppo, libere também a “inicialização automática” do app nas configurações do sistema.

O app mostra uma notificação discreta e silenciosa de “conectado”: é o que o Android exige para manter a conexão viva.

## 3) Usar no computador ou para desenvolver

```bash
npm install
npm start          # abre em http://localhost:3000
```

Os dados ficam em `userdata/`. Para testar o visual sem conectar, a pasta `public/` é só HTML/CSS/JS puro.

## 4) Estrutura

| Pasta | O que é |
|---|---|
| `server/` | Servidor Node.js (Baileys, API, mídia, conversão de áudio) |
| `public/` | Interface (HTML/CSS/JS) |
| `android/` | App Android (WebView + serviço em segundo plano + notificações) |
| `scripts/` | Empacotamento (`build-assets`) e download do Node para Android |
| `.github/workflows/` | Gera o APK na nuvem |

## 5) Personalizar

- **Nome do app:** `android/app/src/main/res/values/strings.xml`.
- **Emuladores x86_64:** em `android/app/build.gradle`, troque `abiFilters 'arm64-v8a'` por `'arm64-v8a', 'x86_64'`.
- **Chave de assinatura própria:** substitua `android/app/zapp.p12` (e as senhas em `build.gradle`) antes de publicar para outras pessoas.
- **GIFs:** em Ajustes → Armazenamento e dados, cole uma chave gratuita do GIPHY ou do Tenor.

## 6) Limitações conhecidas

- **Chamadas de voz/vídeo** não podem ser feitas nem atendidas por aparelhos vinculados. O app mostra chamadas recebidas, permite recusar e,
  ao tentar ligar, oferece abrir o WhatsApp oficial ou fazer uma ligação telefônica.
- **Visualização única:** o WhatsApp não entrega essas mídias a aparelhos vinculados; o app mostra o aviso “Abra no celular”.
- **Enquetes:** é possível criar e ver, mas votar só pelo celular. **Canais** (newsletters) ainda não foram implementados.
- **Status:** aparecem os que chegam enquanto o app está conectado.
- Use por sua conta e risco: o WhatsApp não oferece API oficial para isso e pode restringir contas que usam clientes não oficiais.
