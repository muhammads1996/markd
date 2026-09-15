"use client";

import { useEffect, useState } from "react";

import styles from "./participant.module.css";

export function ParticipantServiceWorkerRegistration() {
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/participant/" })
      .catch(() => {
        setFailure(
          "Offline support could not be enabled. Online use is unaffected.",
        );
      });
  }, []);

  return failure ? (
    <p className={styles.srOnly} role="status">
      {failure}
    </p>
  ) : null;
}
