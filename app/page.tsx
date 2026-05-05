import Script from "next/script";
import { interactionScript, siteHtml, threeSceneScript } from "./site-content";

const contactFormHtml = siteHtml
  .replace(
    '<form class="contact-form" onsubmit="event.preventDefault(); alert(\'Obrigado! Em breve entraremos em contato.\');">',
    '<form class="contact-form">',
  )
  .replace(
    '<input type="text" placeholder="Seu nome completo" required>',
    '<input type="text" name="name" placeholder="Seu nome completo" required>',
  )
  .replace(
    '<input type="text" placeholder="Nome da empresa">',
    '<input type="text" name="company" placeholder="Nome da empresa">',
  )
  .replace(
    '<input type="tel" placeholder="(00) 9 0000-0000" required>',
    '<input type="tel" name="whatsapp" placeholder="(00) 9 0000-0000" required>',
  )
  .replace("<select>", '<select name="need">')
  .replace(
    '<textarea placeholder="Conte um pouco sobre o momento da sua empresa..."></textarea>',
    '<textarea name="message" placeholder="Conte um pouco sobre o momento da sua empresa..."></textarea>',
  );

const contactFormScript = `
  (function () {
    const form = document.querySelector('.contact-form');
    if (!form) return;

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton ? submitButton.textContent : '';
    let messageTimeout;

    function showFormMessage(type, title, text) {
      let message = document.querySelector('.contact-form-message');

      if (!message) {
        message = document.createElement('div');
        message.className = 'contact-form-message';
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        form.appendChild(message);
      }

      message.className = 'contact-form-message contact-form-message--' + type;
      message.innerHTML = '<strong></strong><span></span>';
      message.querySelector('strong').textContent = title;
      message.querySelector('span').textContent = text;

      window.clearTimeout(messageTimeout);
      messageTimeout = window.setTimeout(function () {
        message.classList.add('contact-form-message--hidden');
      }, 6000);
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();

      const formData = new FormData(form);
      const payload = {
        name: formData.get('name') || '',
        company: formData.get('company') || '',
        whatsapp: formData.get('whatsapp') || '',
        need: formData.get('need') || '',
        message: formData.get('message') || ''
      };

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Enviando...';
      }

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Request failed');

        form.reset();
        showFormMessage(
          'success',
          'Solicitação enviada',
          'Obrigado! Em breve entraremos em contato.'
        );
      } catch (error) {
        showFormMessage(
          'error',
          'Não foi possível enviar',
          'Tente novamente em instantes ou fale conosco pelo WhatsApp.'
        );
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
  })();
`;

export default function Home() {
  return (
    <>
      <div
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: contactFormHtml }}
      />
      <Script
        id="eleven-interactions"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: interactionScript }}
      />
      <Script
        id="eleven-contact-form"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: contactFormScript }}
      />
      <Script
        id="eleven-three-scene"
        type="module"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: threeSceneScript }}
      />
    </>
  );
}
