import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
	const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
		undefined,
	);

	React.useEffect(() => {
		const update = () => {
			setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
		};
		update();
		if (typeof window.matchMedia !== "function") {
			return;
		}
		const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, []);

	return !!isMobile;
}
