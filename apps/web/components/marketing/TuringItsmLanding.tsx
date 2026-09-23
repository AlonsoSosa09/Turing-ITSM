import Image from "next/image";
import Link from "next/link";
import styles from "./TuringItsmLanding.module.css";

const navigation = [
  ["Producto", "#producto"],
  ["Capacidades", "#capacidades"],
  ["Cómo funciona", "#como-funciona"],
  ["Contacto", "#contacto"],
] as const;

const capabilities = [
  {
    eyebrow: "Proyectos",
    title: "Trabajo visible, tarea por tarea.",
    description: "Organizá proyectos en tableros y consultá el trabajo asignado a cada integrante.",
  },
  {
    eyebrow: "Daily",
    title: "El pulso del equipo, sin perder contexto.",
    description: "Configurá actualizaciones por equipo, reuní respuestas y revisá sus reportes desde un mismo espacio.",
  },
  {
    eyebrow: "Operación",
    title: "Una lectura clara del día.",
    description: "Accedé a un dashboard operativo para seguir la actividad y las prioridades del equipo.",
  },
  {
    eyebrow: "Acceso",
    title: "Cada persona, en el lugar correcto.",
    description: "Administrá equipos, proyectos y asignaciones para usuarios internos según su rol.",
  },
] as const;

const audiences = [
  ["Liderazgo de TI", "Una vista compartida para seguir la operación y coordinar decisiones."],
  ["Equipos técnicos", "Un espacio de trabajo para mantener proyectos, tareas y actualizaciones alineados."],
  ["Project Managers", "Tableros y responsables que ayudan a convertir el seguimiento en una conversación concreta."],
  ["Operaciones", "Actualizaciones diarias por equipo para sostener el ritmo de trabajo."],
] as const;

export function TuringItsmLanding() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#contenido">Saltar al contenido</a>
      <header className={styles.header}>
        <nav aria-label="Navegación principal" className={styles.nav}>
          <Link aria-label="TuringITSM, inicio" className={styles.brand} href="/">
            <Image alt="" height={34} priority src="/logo.png" width={34} />
            <span>TuringITSM</span>
          </Link>
          <div className={styles.navLinks}>
            {navigation.map(([label, href]) => <a href={href} key={href}>{label}</a>)}
          </div>
          <div className={styles.navActions}>
            <Link className={styles.loginLink} href="/login">Iniciar sesión</Link>
            <a className={styles.navCta} href="#contacto">Solicitar demo</a>
          </div>
        </nav>
      </header>

      <section className={styles.hero} id="contenido">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Gestión operativa para equipos de TI</p>
          <h1>El trabajo de tu equipo, <em>bajo una misma señal.</em></h1>
          <p className={styles.lead}>
            TuringITSM reúne proyectos, tareas y actualizaciones diarias para que los equipos técnicos trabajen con más contexto y menos dispersión.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#contacto">Solicitar demo <span aria-hidden="true">↗</span></a>
            <a className={styles.textButton} href="#producto">Explorar plataforma <span aria-hidden="true">↓</span></a>
          </div>
          <p className={styles.note}>Diseñado para equipos internos que necesitan coordinar trabajo con claridad.</p>
        </div>
        <div className={styles.productStage}>
        <div className={styles.previewLabel}><span aria-hidden="true" /> Un vistazo a tu espacio de trabajo <b>Ejemplo</b></div>
        <div aria-label="Vista ilustrativa de proyectos y Daily, con datos de ejemplo" className={styles.productFrame} role="img">
          <div className={styles.frameGlow} />
          <div className={styles.frameTop}><span /><span /><span /><b>TuringITSM / Operación</b><i>Equipo activo</i></div>
          <div className={styles.frameBody}>
            <aside><strong>TI</strong><span className={styles.activeRail} /><span /><span /><span /></aside>
            <div className={styles.frameContent}>
              <div className={styles.frameHeading}><div><small>MIÉRCOLES · EQUIPO DE PLATAFORMA</small><h2>Panorama operativo</h2></div><span className={styles.frameLink}>Ver proyectos</span></div>
              <div className={styles.statusStrip}><div><small>DAILY</small><b>Respuestas del equipo</b></div><div><small>PROYECTOS</small><b>Tableros compartidos</b></div><div><small>ASIGNADAS</small><b>Trabajo visible</b></div></div>
              <div className={styles.boardPreview}><div><small>PRÓXIMAS</small><article><span className={styles.dot} />Ajustar acceso de equipo</article><article><span className={styles.dot} />Revisar entrega</article></div><div><small>EN PROGRESO</small><article className={styles.focusCard}><span className={styles.dot} />Preparar tablero de proyecto<div className={styles.taskMeta}><span>Plataforma</span><b aria-label="Responsable de ejemplo">AM</b></div></article></div></div>
            </div>
          </div>
          <p className={styles.illustrationNote}>Vista ilustrativa · contenido de ejemplo, no datos en tiempo real.</p>
        </div>
        <div className={styles.dailySnapshot}><div className={styles.dailySnapshotHeader}><span className={styles.dailyIcon} aria-hidden="true">↳</span><div><small>DAILY POR EQUIPO</small><strong>El contexto también cuenta.</strong></div><span className={styles.responseBadge}>Respuesta de ejemplo</span></div><p>¿Qué necesita atención hoy?</p><blockquote>“Necesitamos confirmar los accesos para continuar con la entrega.”</blockquote><div className={styles.snapshotFooter}><span>Equipo de plataforma</span><span>Respuestas · Reportes</span></div></div>
        </div>
      </section>

      <section className={styles.trustBand} aria-label="Equipos para los que está diseñado">
        <p>Diseñado para equipos que necesitan control, visibilidad y trazabilidad del trabajo.</p>
        <ul><li>IT OPERATIONS</li><li>SERVICE DESK</li><li>SOFTWARE TEAMS</li><li>PROJECT MANAGEMENT</li></ul>
      </section>

      <section className={styles.problemSection} id="producto">
        <div className={styles.sectionIntro}><p className={styles.kicker}>De dispersión a dirección</p><h2>Menos estado repartido.<br />Más conversación útil.</h2></div>
        <div className={styles.problemGrid}>
          <article><span>01</span><h3>Contexto fragmentado</h3><p>Cuando proyectos, responsables y actualizaciones viven separados, dar seguimiento consume más tiempo del necesario.</p></article>
          <article className={styles.solutionCard}><span>02</span><h3>Un ritmo compartido</h3><p>Tableros, asignaciones y Dailies por equipo crean una referencia común para el trabajo de cada día.</p></article>
        </div>
      </section>

      <section className={styles.capabilities} id="capacidades">
        <div className={styles.sectionIntro}><p className={styles.kicker}>Capacidades actuales</p><h2>La plataforma se organiza alrededor de cómo trabaja tu equipo.</h2></div>
        <div className={styles.capabilityGrid}>{capabilities.map((capability, index) => <article className={styles.capability} key={capability.eyebrow}><span className={styles.capabilityIndex}>0{index + 1}</span><p>{capability.eyebrow}</p><h3>{capability.title}</h3><p>{capability.description}</p><span className={styles.capabilityMark} aria-hidden="true">↗</span></article>)}</div>
      </section>

      <section className={styles.showcase} aria-labelledby="showcase-title">
        <div className={styles.showcaseVisual}><span className={styles.showcaseLabel}>PROYECTOS + DAILY · EJEMPLO</span><div className={styles.signalLine} /><div className={styles.dailyCard}><small>DAILY · EQUIPO</small><strong>¿Qué necesita atención hoy?</strong><p className={styles.dailyQuestion}>Una pregunta. El contexto de todo el equipo.</p><div><span /><span /><span /></div></div><div className={styles.projectCard}><small>PROYECTO</small><strong>Entrega de plataforma</strong><p>En progreso</p></div></div>
        <div className={styles.showcaseCopy}><p className={styles.kicker}>Un sistema de señales</p><h2 id="showcase-title">Lo importante aparece donde el equipo trabaja.</h2><p>El dashboard operativo concentra la actividad. Los proyectos y sus tableros permiten seguir el avance. Daily sostiene una cadencia de actualizaciones por equipo.</p><a className={styles.textButton} href="#como-funciona">Ver cómo funciona <span aria-hidden="true">↓</span></a></div>
      </section>

      <section className={styles.audiences}>
        <div className={styles.sectionIntro}><p className={styles.kicker}>Hecho para colaborar</p><h2>Una plataforma que le habla claro a cada rol.</h2></div>
        <div className={styles.audienceGrid}>{audiences.map(([title, description]) => <article key={title}><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className={styles.steps} id="como-funciona">
        <div className={styles.sectionIntro}><p className={styles.kicker}>Cómo funciona</p><h2>Un ciclo simple para ordenar la operación.</h2></div>
        <ol><li><b>01</b><div><h3>Centralizá</h3><p>Reuní proyectos, tableros y trabajo asignado en un mismo espacio.</p></div></li><li><b>02</b><div><h3>Actualizá</h3><p>Usá Dailies por equipo para sostener el contexto de cada jornada.</p></div></li><li><b>03</b><div><h3>SeguÍ</h3><p>Consultá la actividad operativa y mantené el foco en lo que sigue.</p></div></li></ol>
      </section>

      <section className={styles.accessSection}>
        <div><p className={styles.kicker}>Control interno</p><h2>El acceso también forma parte de la operación.</h2></div><p>TuringITSM contempla cuentas internas activas, roles y asignaciones de equipos y proyectos para organizar quién puede acceder a cada espacio de trabajo.</p>
      </section>

      <section className={styles.contact} id="contacto">
        <div className={styles.contactIntro}><p className={styles.kicker}>Conversemos</p><h2>Convertí el seguimiento operativo en un proceso visible.</h2><p>Conocé cómo TuringITSM puede ordenar el trabajo de tus equipos internos.</p></div>
        <form aria-describedby="contact-note" className={styles.contactForm}>
          <label>Nombre<input aria-label="Nombre" autoComplete="name" disabled name="name" placeholder="Tu nombre" type="text" /></label><label>Empresa<input aria-label="Empresa" autoComplete="organization" disabled name="company" placeholder="Nombre de tu empresa" type="text" /></label><label className={styles.fullField}>Email corporativo<input aria-label="Email corporativo" autoComplete="email" disabled name="email" placeholder="nombre@empresa.com" type="email" /></label><button disabled type="button">Canal de demo en preparación</button><p id="contact-note">Este formulario es una vista previa; todavía no envía información.</p>
        </form>
      </section>

      <footer className={styles.footer}><Link className={styles.brand} href="/"><Image alt="" height={28} src="/logo.png" width={28} /><span>TuringITSM</span></Link><div><a href="#capacidades">Capacidades</a><a href="#contacto">Contacto</a><Link href="/login">Iniciar sesión</Link></div><p>© {new Date().getFullYear()} TuringITSM</p></footer>
    </main>
  );
}

