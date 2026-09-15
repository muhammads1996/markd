import {
  ConnectivityState,
  ParticipantAppBar,
  participantStyles as styles,
} from "../../../components/participant";

export default function OfflinePage() {
  return (
    <div className={styles.app}>
      <ParticipantAppBar connected={false} />
      <main className={styles.content}>
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Connection</p>
          <h1 className={styles.title}>You are offline</h1>
        </header>
        <ConnectivityState />
      </main>
    </div>
  );
}
