
import type { AnalyzeDocumentOutput } from "@/lib/types";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ListChecks, TestTube2, MessageSquareQuote } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ReactElement, JSXElementConstructor, ReactNode, ReactPortal, AwaitedReactNode, Key } from "react";

interface DocumentAnalysisResultsProps {
    result: AnalyzeDocumentOutput;
}

export default function DocumentAnalysisResults({ result }: DocumentAnalysisResultsProps) {
    const { summary, keyDataPoints, recommendations } = result;

    return (
        <div className="space-y-6 text-sm animated-fade-in">

            <Card className="bg-primary/5">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                         <MessageSquareQuote className="h-5 w-5 text-primary" />
                         AI Summary
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-foreground">{summary}</p>
                </CardContent>
            </Card>

            {keyDataPoints && keyDataPoints.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <TestTube2 className="h-5 w-5 text-primary" />
                            Key Data Points
                        </CardTitle>
                        <CardDescription>
                            The most important metrics extracted from your document.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                             <TableHeader>
                                <TableRow>
                                    <TableHead>Metric</TableHead>
                                    <TableHead>Value</TableHead>
                                    <TableHead>Reference Range</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {keyDataPoints.map((point: { metric: string; value: string; range?: string }, index: Key | null | undefined) => (
                                    <TableRow key={index}>
                                        <TableCell className="font-medium">{point.metric}</TableCell>
                                        <TableCell>{point.value}</TableCell>
                                        <TableCell className="text-muted-foreground">{point.range || 'N/A'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {recommendations && recommendations.length > 0 && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                           <ListChecks className="h-5 w-5 text-primary" />
                           Recommendations
                        </CardTitle>
                        <CardDescription>
                            General suggestions based on the analysis. This is not medical advice.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-2 list-disc pl-5 text-muted-foreground">
                            {recommendations.map((rec: string, index: Key | null | undefined) => (
                                <li key={index}>{rec}</li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
