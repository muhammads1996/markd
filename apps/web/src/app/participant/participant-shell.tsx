"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "./participant.module.css";

type ParticipantRole = "worker" | "contractor";

const workerNav = ["Home", "Work", "My Card", "Profile"];
const contractorNav = ["Home", "Hire", "Workers", "Jobs"];

function StatusPill({ children }: { children: string }) {
  return <span className={styles.statusPill}>{children}</span>;
}

function ListenButton() {
  return (
    <button className={styles.listenButton} type="button" aria-label="Listen">
      <span aria-hidden="true">&#9654;</span> LISTEN
    </button>
  );
}

function WorkerHome() {
  return (
    <>
      <header className={styles.greeting}>
        <div>
          <p className={styles.eyebrow}>GOOD MORNING, ANELE</p>
          <h1>Do I have work today?</h1>
        </div>
        <button className={styles.avatar} type="button" aria-label="Open profile">AS</button>
      </header>

      <section className={styles.confirmedHero} aria-labelledby="confirmed-title">
        <div className={styles.heroTopline}>
          <StatusPill>WORK CONFIRMED</StatusPill>
          <span className={styles.heroDate}>Tomorrow</span>
        </div>
        <h2 id="confirmed-title">Site crew at CapeBuild</h2>
        <p className={styles.heroPlace}>Bellville South, Cape Town</p>
        <div className={styles.heroDetails}>
          <span><strong>06:30</strong> arrival</span>
          <span><strong>General labour</strong> role</span>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} href="/participant/worker-confirmed">View travel details</Link>
          <ListenButton />
        </div>
        <p className={styles.travelNote}>You can travel. This job is confirmed.</p>
      </section>

      <section className={styles.section} aria-labelledby="offers-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>NEXT UP</p><h2 id="offers-title">Work offers</h2></div>
          <span className={styles.count}>2</span>
        </div>
        <article className={styles.offerCard}>
          <div className={styles.cardRow}>
            <div><StatusPill>OFFER</StatusPill><h3>Ridgeway build team</h3><p>Parow East · Friday, 07:00</p></div>
            <ListenButton />
          </div>
          <p className={styles.offerWarning}>Accepting an offer does not confirm travel.</p>
          <button className={styles.secondaryButton} type="button">Review offer</button>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="card-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>YOUR RECORD</p><h2 id="card-title">Your Work Card</h2></div>
          <Link className={styles.textLink} href="/participant/card">Open card</Link>
        </div>
        <article className={styles.workCard}>
          <div className={styles.cardRow}><div className={styles.cardIdentity}><div className={styles.largeAvatar}>AS</div><div><h3>Anele Sample</h3><p>General labour</p></div></div><span className={styles.verified} aria-label="Verified Work Card">&#10003;</span></div>
          <div className={styles.metrics}><div><strong>8</strong><span>confirmed Workmarks</span></div><div><strong>3</strong><span>repeat contractors</span></div><div><strong>2</strong><span>recent months</span></div></div>
          <div className={styles.chips}><span>General labour</span><span>Site preparation</span><span>Team work</span></div>
        </article>
      </section>
    </>
  );
}

function ContractorHome() {
  return (
    <>
      <header className={styles.greeting}>
        <div><p className={styles.eyebrow}>CAPE BUILD CONTRACTORS</p><h1>Is your crew ready?</h1></div>
        <button className={styles.avatar} type="button" aria-label="Open profile">CB</button>
      </header>

      <section className={styles.readinessCard} aria-labelledby="readiness-title">
        <div className={styles.cardRow}><StatusPill>THURSDAY CREW</StatusPill><span className={styles.readinessNumber}>8/10</span></div>
        <h2 id="readiness-title">2 workers still needed</h2>
        <p>Known workers are shown first so you can build with people you trust.</p>
        <div className={styles.progress} aria-label="8 of 10 workers confirmed"><span /></div>
        <Link className={styles.primaryButton} href="/participant/contractor/hire">Find 2 workers</Link>
      </section>

      <section className={styles.section} aria-labelledby="trusted-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR NETWORK</p><h2 id="trusted-title">Trusted workers</h2></div><Link className={styles.textLink} href="/participant/contractor/workers">View all</Link></div>
        <div className={styles.workerList}>
          <article className={styles.workerMiniCard}><div className={styles.largeAvatar}>SM</div><div><h3>Sam Mokoena <span className={styles.verified}>&#10003;</span></h3><p>General labour · 8 confirmed Workmarks</p><div className={styles.chips}><span>Repeat worker</span></div></div></article>
          <article className={styles.workerMiniCard}><div className={styles.largeAvatar}>TK</div><div><h3>Thando Khumalo</h3><p>Site preparation · 5 confirmed Workmarks</p><div className={styles.chips}><span>Last worked 2 weeks ago</span></div></div></article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="jobs-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>WORK GRAPH</p><h2 id="jobs-title">Recent jobs</h2></div><span className={styles.count}>3</span></div>
        <article className={styles.jobRow}><div><strong>Riverside site</strong><span>12 confirmed Workmarks</span></div><StatusPill>COMPLETED</StatusPill></article>
        <article className={styles.jobRow}><div><strong>Oak Avenue renovation</strong><span>6 confirmed Workmarks</span></div><StatusPill>COMPLETED</StatusPill></article>
      </section>
    </>
  );
}

export default function ParticipantShell({ role }: { role: ParticipantRole }) {
  const [active, setActive] = useState("Home");
  const navItems = role === "worker" ? workerNav : contractorNav;

  return (
    <main className={styles.app}>
      <div className={styles.topBar}><Link href={role === "worker" ? "/participant/contractor" : "/participant"} className={styles.wordmark}>MARKD<span>.</span></Link><span className={styles.connection}><i /> Connected</span></div>
      <div className={styles.content}>
        {role === "worker" ? <WorkerHome /> : <ContractorHome />}
        <section className={styles.settings} aria-label="Profile and accessibility settings"><span>Language: English</span><button type="button">Accessibility settings</button></section>
      </div>
      <nav className={styles.bottomNav} aria-label={`${role} navigation`}>
        {navItems.map((item, index) => <button key={item} className={active === item ? styles.navActive : ""} type="button" onClick={() => setActive(item)}><span aria-hidden="true">{["⌂", "◈", "▣", "●"][index]}</span>{item}</button>)}
      </nav>
    </main>
  );
}