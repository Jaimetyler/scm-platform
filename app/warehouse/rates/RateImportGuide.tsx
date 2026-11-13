import styles from "./rates.module.css";

export default function RateImportGuide({ columns }: {
  columns: readonly (readonly [header: string, requirement: string, description: string])[];
}) {
  return <details className={styles.importGuide} open>
    <summary>Column guide</summary>
    <div className={styles.guideScroll}>
      <table aria-label="Rate import columns">
        <thead><tr><th scope="col">Template header</th><th scope="col">Required?</th><th scope="col">What to enter</th></tr></thead>
        <tbody>{columns.map(([header, requirement, description]) => <tr key={header}>
          <th scope="row"><code>{header}</code></th><td>{requirement}</td><td>{description}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}
