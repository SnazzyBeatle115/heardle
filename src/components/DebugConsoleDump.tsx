"use client";

import { useEffect, useRef } from "react";

type DebugConsoleDumpProps = {
    payload: unknown;
};

export function DebugConsoleDump({ payload }: DebugConsoleDumpProps) {
    const hasLogged = useRef(false);

    useEffect(() => {
        if (hasLogged.current) {
            return;
        }

        hasLogged.current = true;
        console.groupCollapsed("[Heardle Debug] Response dump");
        console.log(payload);
        console.groupEnd();
    }, [payload]);

    return null;
}